/**
 * dsh-unrestricted host half: fuses the unrestricted execution mode into each
 * preset's ORIGINAL system prompt at assembly time and exposes read-only previews.
 *
 * Mechanism (public interfaces only):
 * - A root `system-prompt/assemble` waterfall listener receives every agent's
 *   assembly (unscoped listeners pass the dsh-scope filter). When enabled, it
 *   fuses the preset's sections structurally: extending `deployment:persona-prefix`
 *   in place, inserting the `unrestricted:execution-mode` section right after the
 *   persona, and appending boundary notes to any present `plan:policy`,
 *   `tools:ptc-only`, or `tool:structured_output` sections. Tools, contexts,
 *   and variables pass through untouched; when disabled the listener returns
 *   `next()` verbatim, so the prompt is byte-identical to the unmodified harness.
 * - `minimal` registers its persona with `complete: true`, which the registry
 *   restores AFTER the waterfall, so waterfall edits cannot reach it. For
 *   minimal agents (joined, switched via `agent-preset/selected`, or later
 *   created) the plugin shadows `deployment:persona-prefix` at agent scope with
 *   a complete section carrying the fused minimal prompt, and disposes that
 *   shadow immediately if the blank session switches away to another preset.
 * - Rosterless profiles (such as `headless`, `acp`, or `sdk`) mount no
 *   `agentPresets` service; the plugin detects the active host composition
 *   (`ptc` when `tools:ptc-only` is present, otherwise `standard`) and fuses
 *   their assemblies directly.
 */
import { fallbackSchema, renderPrompt, z } from './deps.js'
import { installMobile } from './mobile.js'
import {
  ANCHORS,
  PRESETS,
  fuseSections,
  fusedMinimalPrompt,
  renderPreview,
  stripHostIdentityFromAssembly,
} from './rules.js'
import { registerRpcRoutes } from './rpc.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-unrestricted'

/** Current plugin package version. */
export const PLUGIN_VERSION = '0.2.15-mobile.1'

/**
 * Services this plugin cannot work without. `settings` is deliberately absent:
 * it only mirrors the toggle for the web card, and a host that does not mount
 * it (some DSH Go compositions) must still load the plugin instead of leaving
 * the entry pending forever.
 */
export const inject = ['systemPrompt', 'loader']

// The engine's schemastery when reachable, a shape-compatible subset otherwise
// (see deps.js). Either way `config.get()` and the settings form keep working.
const schema = z ?? fallbackSchema

export const Config = schema.object({
  enabled: schema.boolean().default(false).description({
    zh: '启用破限：把执行规则融合进当前预设的系统提示词，下一轮对话起生效',
    en: 'Enable unrestricted mode: fuse the execution rules into the active preset prompt, from the next turn',
  }),
  stripHostIdentity: schema.boolean().default(false).description({
    zh: '脱敏宿主标识：把 harness 身份段里的 DSH 标记去掉',
    en: 'Strip host identity: remove the DSH markers from the harness identity sections',
  }),
  extraPresets: schema.array(schema.string()).default([]).description({
    zh: '额外预设 id：除 standard/ptc/cordis/minimal 外也要融合的预设',
    en: 'Extra preset ids to fuse besides standard/ptc/cordis/minimal',
  }),
}).default({ enabled: false, stripHostIdentity: false, extraPresets: [] }).volatile()

/**
 * Read the config from a Cordis handle, a plain object, or nothing.
 * @param {unknown} config - whatever the host handed us.
 * @returns {{enabled: boolean, stripHostIdentity: boolean, extraPresets: string[]}}
 */
function readConfig(config) {
  try {
    const value = typeof config?.get === 'function' ? config.get() : config
    return {
      enabled: value?.enabled === true,
      stripHostIdentity: value?.stripHostIdentity === true,
      extraPresets: Array.isArray(value?.extraPresets) ? value.extraPresets.filter(item => typeof item === 'string') : [],
    }
  } catch {
    return { enabled: false, stripHostIdentity: false, extraPresets: [] }
  }
}

/** Human-readable error text for diagnostics and RPC error branches. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** RpcResult success branch. */
function ok(value) {
  return { ok: true, value }
}

/**
 * @param ctx - plugin context carrying settings, systemPrompt, loader, and
 *   optional agentPresets / connection services.
 */
export function apply(ctx, config = {}) {
  // The settings mirror exists only for the web settings card; a host without
  // that service (some DSH Go compositions) keeps working without it.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })

  const initialConfig = readConfig(config)
  const state = {
    enabled: Boolean(initialConfig.enabled),
    stripHostIdentity: Boolean(initialConfig.stripHostIdentity),
    extraPresets: new Set(initialConfig.extraPresets ?? []),
    /** presetId -> issue codes observed on live assemblies. */
    runtime: new Map(),
    /** Agent -> section disposer for minimal persona shadows. */
    shadows: new Map(),
    /** Minimal agents whose persona was already registered at agent scope by caller. */
    customMinimal: new WeakSet(),
    /** Precomputed fused minimal prompt. */
    fusedMinimal: fusedMinimalPrompt(),
    /** Listeners for the native (dsh-go) surfaces: status changed. */
    listeners: new Set(),
    /** Last top-level assembly this plugin saw: { presetId, fused, names, at }. */
    lastAssembly: undefined,
  }

  /**
   * Read the standing assembly of a preset using the registry's scope lease
   * (DSH >= 0.2.1) or scope helper fallback (DSH 0.2.0-rc.2).
   * In rosterless profiles, assemble the global host layer directly.
   */
  async function presetAssembly(presetId) {
    await ctx.loader.await()
    const presets = ctx.get('agentPresets')
    if (presets === undefined) {
      return await ctx.systemPrompt.assemble({})
    }
    if (typeof presets.acquireScope === 'function') {
      const lease = await presets.acquireScope(presetId)
      try {
        return await ctx.systemPrompt.assemble({ scope: lease.key })
      } finally {
        await lease[Symbol.asyncDispose]()
      }
    }
    // DSH 0.2.1 line (the engine inside DSH Go) has no scope lease: mount the
    // preset into a temporary scope and assemble against it. The helper is
    // imported lazily so a host without the package still loads this plugin.
    let createScope
    try {
      ({ createScope } = await import('@deepseek-ai/dsh-scope'))
    } catch {
      // No scope helper: report the host assembly instead of inventing one.
      return await ctx.systemPrompt.assemble({})
    }
    const key = {}
    const scope = createScope(ctx, key)
    try {
      await presets.mount(scope.ctx, presetId)
      return await ctx.systemPrompt.assemble({ scope: key })
    } finally {
      await scope.dispose()
    }
  }

  /**
   * Remove a minimal persona shadow from an agent when it switches preset, is
   * disposed, or unrestricted mode turns off.
   */
  function unshadowMinimal(agent) {
    const dispose = state.shadows.get(agent)
    if (dispose === undefined) return
    state.shadows.delete(agent)
    dispose()
  }

  /**
   * Resolve the composed preset id for a live agent, or infer `ptc`/`standard`
   * when running in a rosterless profile (e.g. headless / sdk).
   */
  function resolveAgentPreset(agent, sections) {
    const presets = ctx.get('agentPresets')
    if (presets !== undefined) {
      try {
        return presets.composedPreset(agent.ctx)
      } catch {
        return undefined
      }
    }
    if (sections !== undefined) {
      return sections.some(s => s.name === 'tools:ptc-only' && s.text.trim() !== '')
        ? 'ptc'
        : 'standard'
    }
    return undefined
  }

  /**
   * Synchronize a minimal agent's complete persona shadow with its current
   * preset and toggle state. If the agent is no longer on `minimal`, any stale
   * shadow from an earlier blank-session preset selection is disposed.
   */
  function syncMinimalShadow(agent) {
    if (!state.enabled) {
      unshadowMinimal(agent)
      return
    }
    const presetId = resolveAgentPreset(agent)
    if (presetId !== 'minimal') {
      unshadowMinimal(agent)
      return
    }
    if (state.shadows.has(agent) || state.customMinimal.has(agent)) return
    let dispose
    try {
      dispose = agent.ctx.systemPrompt.section({
        name: 'deployment:persona-prefix',
        order: 0,
        complete: true,
        text: (context) => {
          const hasStructured = context?.agent?.ctx?.tools
            ?.schemas?.(context.agent)
            ?.some(tool => tool.name === 'structured_output') === true
          return hasStructured
            ? fusedMinimalPrompt(ANCHORS.structuredOutputFull)
            : state.fusedMinimal
        },
      })
    } catch (error) {
      if (messageOf(error) !== 'prompt section "deployment:persona-prefix" is already registered in this scope') throw error
      state.customMinimal.add(agent)
      return
    }
    state.shadows.set(agent, dispose)
  }

  /** Synchronize minimal persona shadows across all live agents. */
  function sweepAgents() {
    const agents = ctx.get('agents')
    if (agents === undefined) return
    for (const agent of agents.list()) syncMinimalShadow(agent)
  }

  /** Drop every persona shadow (toggle off or plugin disposal). */
  function clearShadows() {
    for (const [, dispose] of state.shadows) dispose()
    state.shadows.clear()
  }

  /** Wake every native surface so it re-reads the status snapshot. */
  function notify() {
    for (const listener of state.listeners) {
      try {
        listener()
      } catch {
        // A surface that cannot repaint must not break the toggle lifecycle.
      }
    }
  }

  /**
   * Subscribe a native surface to status changes.
   * @param {() => void} listener - called after a toggle or recheck.
   * @returns {() => void} unsubscribe.
   */
  function subscribe(listener) {
    state.listeners.add(listener)
    return () => state.listeners.delete(listener)
  }

  function onEnable() {
    state.runtime.clear()
    sweepAgents()
    void ctx.loader.await().then(() => {
      if (state.enabled) sweepAgents()
    })
    notify()
  }

  function onDisable() {
    clearShadows()
    state.runtime.clear()
    notify()
  }

  /** Current card view: toggle, stripHostIdentity flag, version, and per-preset state. */
  function statusPayload() {
    const modes = {}
    for (const presetId of PRESETS) {
      const issues = state.runtime.get(presetId) ?? []
      modes[presetId] = {
        state: !state.enabled
          ? 'off'
          : issues.length > 0 ? 'failed' : 'active',
        issues,
      }
    }
    return {
      enabled: state.enabled,
      stripHostIdentity: state.stripHostIdentity,
      version: PLUGIN_VERSION,
      modes,
      lastAssembly: state.lastAssembly,
    }
  }

  /** One line-count/byte summary so the preview reports size metadata. */
  function summarize(text) {
    return {
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      lines: text.split('\n').length,
    }
  }

  /**
   * Variables to bind in a standing-scope preview. When a live agent exists,
   * borrow its route and working directory so the card reads a realistic
   * prompt instead of raw slots.
   */
  function previewVariables() {
    const variables = {}
    try {
      const agents = ctx.get('agents')
      const agent = agents?.list?.()[0]
      if (agent !== undefined) {
        variables.provider = agent.options.provider
        variables.model = agent.options.model
        variables.cwd = agent.session.header.cwd
      }
    } catch {
      // No agent service or an unreadable session: literal slots are fine.
    }
    return variables
  }

  /**
   * Build the deploy preview for ONE preset from the same assembly path the
   * live fusion uses. Read-only — never mutates prompt state.
   */
  async function previewFor(presetId) {
    if (typeof presetId !== 'string' || presetId === '') {
      return {
        presetId,
        available: false,
        errorCode: 'unsupported-preset',
        reason: 'preview needs a preset id',
      }
    }
    try {
      const assembly = await presetAssembly(presetId)
      let previewAssembly
      if (presetId === 'minimal') {
        previewAssembly = {
          ...assembly,
          sections: [{ name: 'deployment:persona-prefix', text: fusedMinimalPrompt() }],
        }
      } else {
        const fused = fuseSections(assembly.sections, presetId, {
          allowDynamicPreset: state.extraPresets.has(presetId),
        })
        if (fused.issues !== undefined) {
          return {
            presetId,
            available: false,
            errorCode: 'missing-persona',
            reason: fused.issues.join('; '),
          }
        }
        previewAssembly = { ...assembly, sections: fused.sections }
      }
      if (state.stripHostIdentity) {
        previewAssembly = stripHostIdentityFromAssembly(previewAssembly)
      }
      const variables = { ...previewAssembly.variables, ...previewVariables() }
      if (renderPrompt === undefined) {
        // Fusion itself needs no renderer; only this preview text does.
        return {
          presetId,
          available: false,
          errorCode: 'preview-failed',
          reason: 'preview needs @deepseek-ai/dsh-system-prompt, which this host does not expose',
        }
      }
      const text = renderPreview({ ...previewAssembly, variables }, renderPrompt)
      return { presetId, available: true, source: 'standing', ...summarize(text) }
    } catch (error) {
      return {
        presetId,
        available: false,
        errorCode: 'preview-failed',
        reason: messageOf(error),
      }
    }
  }

  /**
   * Locate this plugin's own loader entry, so the native surfaces can write the
   * same `enabled` value the settings page writes.
   * @returns {import('@deepseek-ai/cordis-plugin-loader').Entry | undefined}
   */
  function resolveEntry() {
    const own = ctx.fiber?.entry
    if (own !== undefined && own.options?.name === name) return own
    try {
      for (const entry of ctx.loader.entries()) {
        if (entry.options?.name === name) return entry
      }
    } catch {
      // A host without a readable entry tree: the panel toggle stays inert.
    }
    return undefined
  }

  /**
   * Persist the toggle through the loader entry (volatile config ⇒ no remount,
   * `loader/volatile-update` drives the same lifecycle as the web card).
   * @param {boolean} next - the requested state.
   * @returns {Promise<boolean>} whether the write was accepted.
   */
  async function setEnabled(next) {
    const entry = resolveEntry()
    if (entry === undefined) return false
    try {
      await entry.update({ config: { ...(entry.options?.config ?? {}), enabled: next } })
    } catch {
      return false
    }
    // An unchanged value emits no volatile update; keep the surfaces honest.
    if (state.enabled !== next) {
      state.enabled = next
      if (next) onEnable()
      else onDisable()
    }
    notify()
    return true
  }

  /** Re-run the live status from scratch (native panel and RPC `recheck`). */
  async function recheckAll() {
    state.runtime.clear()
    if (state.enabled) sweepAgents()
    notify()
    return statusPayload()
  }

  /** RPC endpoint handler for the settings card. */
  async function handleRpc(endpoint, payload) {
    switch (endpoint) {
      case 'status': {
        return ok(statusPayload())
      }
      case 'preview': {
        const presetId = payload?.presetId ?? payload?.args?.presetId
        return ok(await previewFor(presetId))
      }
      case 'recheck': {
        return ok(await recheckAll())
      }
      default:
        return {
          ok: false,
          error: {
            code: 'internal',
            message: `dsh-unrestricted: unknown endpoint ${JSON.stringify(endpoint)}`,
            details: {},
          },
        }
    }
  }

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const original = await next()
    if (!state.enabled && !state.stripHostIdentity) return original
    const agent = context.agent
    if (agent === undefined) return original
    const presetId = resolveAgentPreset(agent, original.sections)
    // An unknown or unreadable preset still receives the contract (standard
    // boundary rules); dropping fusion there is what a host that adds presets
    // would otherwise see as "the plugin stopped working".
    if (presetId === undefined) {
      unshadowMinimal(agent)
      return original
    }
    if (!original.contexts.some(entry => entry.name === 'subagent:delegation')) {
      state.lastAssembly = {
        presetId,
        names: original.sections.map(section => section.name),
        at: Date.now(),
      }
    }

    let current = original

    if (presetId === 'minimal') {
      if (state.enabled) {
        if (!state.shadows.has(agent)) syncMinimalShadow(agent)
        if (state.customMinimal.has(agent)) {
          const fused = fuseSections(current.sections, 'minimal', { isSubagent: true })
          if (fused.issues !== undefined) {
            state.runtime.set('minimal', fused.issues)
            return state.stripHostIdentity ? stripHostIdentityFromAssembly(current) : current
          }
          state.runtime.delete('minimal')
          current = { ...current, sections: fused.sections }
        }
      } else if (state.shadows.has(agent)) {
        unshadowMinimal(agent)
      }
      return state.stripHostIdentity ? stripHostIdentityFromAssembly(current) : current
    }

    if (state.shadows.has(agent)) {
      unshadowMinimal(agent)
    }

    if (state.enabled) {
      const isSubagent = current.contexts.some(entry => entry.name === 'subagent:delegation')
      const fused = fuseSections(current.sections, presetId, {
        isSubagent,
        allowDynamicPreset: true,
      })
      if (state.lastAssembly !== undefined) state.lastAssembly.fused = fused.issues === undefined
      if (fused.issues !== undefined) {
        state.runtime.set(presetId, fused.issues)
        return state.stripHostIdentity ? stripHostIdentityFromAssembly(current) : current
      }
      state.runtime.delete(presetId)
      current = { ...current, sections: fused.sections }
    }

    return state.stripHostIdentity ? stripHostIdentityFromAssembly(current) : current
  })

  ctx.on('agent/created', ({ agent }) => {
    if (!state.enabled) return
    syncMinimalShadow(agent)
  })

  ctx.on('agent-preset/selected', (sessionId) => {
    const agent = ctx.get('agents')?.get?.(sessionId)
    if (agent === undefined) return
    state.customMinimal.delete(agent)
    if (!state.enabled) {
      unshadowMinimal(agent)
      return
    }
    syncMinimalShadow(agent)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    state.customMinimal.delete(agent)
    unshadowMinimal(agent)
  })

  ctx.effect(() => {
    const unwatch = ctx.on('loader/volatile-update', () => {
      const nextConfig = readConfig(config)
      const enabled = nextConfig.enabled
      state.stripHostIdentity = nextConfig.stripHostIdentity
      state.extraPresets = new Set(nextConfig.extraPresets)
      if (enabled === state.enabled) return
      state.enabled = enabled
      if (enabled) onEnable()
      else onDisable()
    })
    if (state.enabled) onEnable()
    return () => {
      state.enabled = false
      unwatch()
      clearShadows()
    }
  }, 'dsh-unrestricted: toggle lifecycle')

  // 挂载到 Connection 自有的 /api 共享通道下，无需依赖 connection 自身注入 webServer。
  ctx.inject(['connection'], (connectionCtx) => {
    return registerRpcRoutes(connectionCtx.connection, handleRpc)
  })

  // DSH Go（Android）原生界面：胶囊 + 状态条 + 面板。只在带 dsh-go 桥接的
  // 主机生效，桌面网页版与 headless 完全不受影响。
  installMobile(ctx, {
    getSnapshot: statusPayload,
    subscribe,
    setEnabled,
    recheck: recheckAll,
  })
}
