/**
 * dsh-unrestricted host half: fuses the unrestricted execution mode into each
 * preset's ORIGINAL system prompt at assembly time.
 *
 * Mechanism (public interfaces only):
 * - A root `system-prompt/assemble` waterfall listener receives every agent's
 *   assembly (unscoped listeners pass the dsh-scope filter). When enabled, it
 *   verifies the anchors of the agent's preset against the live sections and
 *   returns the same section list with the persona extended in place, the
 *   execution-mode section inserted behind the persona, and boundary notes
 *   appended to the plan / PTC-only / structured-output sections. Tools,
 *   contexts, and variables pass through untouched; when disabled the
 *   listener returns `next()` verbatim, so the prompt is byte-identical to
 *   the unmodified harness.
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
 * - Anchor failures (startup standing-scope check or any live assembly) leave
 *   that prompt unchanged and show the failed current-master invariant in the
 *   settings card.
 *
 * The toggle lives in the `unrestricted` settings namespace (persisted to
 * $DSH_HOME/profiles/web/cordis.patch.yml). Switching affects the NEXT assembly of any live
 * or future agent — never an in-flight request or a logged session event.
 */
import { fallbackSchema, renderPrompt, z } from './deps.js'
import { installMobile } from './mobile.js'
import {
  ANCHORS, PRESETS, PRESET_RULES, contractFingerprint, fuseSections, fusedMinimalPrompt, renderPreview,
} from './rules.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-unrestricted'

/**
 * Services this plugin cannot work without. `settings` is deliberately absent:
 * it only mirrors the toggle for the web card, and a host that does not mount
 * it (some DSH Go compositions) must still load the plugin instead of leaving
 * the entry pending forever.
 */
export const inject = ['systemPrompt', 'loader']

const RPC_CHANNEL = '/dsh-unrestricted'

// The engine's schemastery when reachable, a shape-compatible subset otherwise
// (see deps.js). Either way `config.get()` and the settings form keep working.
const schema = z ?? fallbackSchema

export const Config = schema.object({
  enabled: schema.boolean().default(false).description({
    zh: '启用破限：把执行规则融合进当前预设的系统提示词，下一轮对话起生效',
    en: 'Enable unrestricted mode: fuse the execution rules into the active preset prompt, from the next turn',
  }),
}).default({ enabled: false }).volatile()

/** Human-readable error text for status and RPC error branches. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** RpcResult success branch. */
function ok(value) {
  return { ok: true, value }
}

/**
 * Read `enabled` from a Cordis config handle, a plain object, or nothing.
 *
 * In the engine the second `apply` argument is the Schemastery-validated value
 * (`.get()`); a host that mounts the plugin without a schema — the plugin kit's
 * fake host, a minimal composition — passes the raw object instead.
 * @param {unknown} config - whatever the host handed us.
 * @returns {boolean} the toggle, defaulting to off.
 */
function readEnabled(config) {
  try {
    const value = typeof config?.get === 'function' ? config.get() : config
    return value?.enabled === true
  } catch {
    return false
  }
}

/**
 * @param ctx - plugin context carrying systemPrompt and loader, plus optional
 *   settings / agentPresets / connection / dshGo services.
 */
export function apply(ctx, config = {}) {
  // The settings mirror exists only for the web settings card; a host without
  // that service (some DSH Go compositions) keeps working without it.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })

  const state = {
    enabled: readEnabled(config),
    /** presetId -> issue strings; a preset with an empty list is verified. */
    startup: new Map(),
    /** presetId -> in-flight startup check. */
    checking: new Map(),
    /** presetId -> issue strings observed on live assemblies. */
    runtime: new Map(),
    /** Agent -> section disposer for minimal persona shadows. */
    shadows: new Map(),
    /** 已由调用方在 agent scope 注册 persona 的 Minimal agent。 */
    customMinimal: new WeakSet(),
    /** Fused minimal prompt, computed only after the minimal anchors verify. */
    fusedMinimal: null,
    /** presetId -> last successfully fused top-level live assembly (the deploy preview). */
    fusedText: new Map(),
    /** Listeners for the native (dsh-go) surfaces: status changed. */
    listeners: new Set(),
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
   * @param {() => void} listener - called after a toggle, check, or recheck.
   * @returns {() => void} unsubscribe.
   */
  function subscribe(listener) {
    state.listeners.add(listener)
    return () => state.listeners.delete(listener)
  }

  /** All known issues for one preset (startup check + live observations). */
  function modeIssues(presetId) {
    return [...state.startup.get(presetId) ?? [], ...state.runtime.get(presetId) ?? []]
  }

  /**
   * Read the standing assembly of a preset using the registry's scope lease
   * (or a temporary mounted scope on pre-0.2.2 registries). In rosterless
   * profiles, assemble the global host layer directly.
   */
  async function presetAssembly(presetId) {
    // 预设声明与本插件是并列 Loader 条目；服务可用时，声明仍可能尚未注册。
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
   * Run the standing-scope anchor check for ONE preset (lazy per-preset, so a
   * minimal toggle never waits on the other three mounts). Idempotent per
   * preset until `recheck` clears it.
   */
  function ensureCheck(presetId) {
    let pending = state.checking.get(presetId)
    if (pending !== undefined) return pending
    pending = (async () => {
      const issues = []
      try {
        await ctx.loader.await()
        const presets = ctx.get('agentPresets')
        if (presets === undefined) {
          // Rosterless profile (e.g. headless / sdk): live assembly checks the
          // host sections directly.
          state.startup.set(presetId, issues)
          return
        }
        const assembly = await presetAssembly(presetId)
        const fused = fuseSections(assembly.sections, presetId)
        if (fused.issues !== undefined) issues.push(...fused.issues)
      } catch (error) {
        issues.push(`preset probe failed: ${messageOf(error)}`)
      }
      state.startup.set(presetId, issues)
      if (presetId === 'minimal') {
        state.fusedMinimal = issues.length === 0 ? fusedMinimalPrompt() : null
      }
      notify()
    })().catch((error) => {
      state.startup.set(presetId, [`preset probe failed: ${messageOf(error)}`])
      if (presetId === 'minimal') state.fusedMinimal = null
      notify()
    })
    state.checking.set(presetId, pending)
    return pending
  }

  /** Check every preset once (status surface and the `recheck` endpoint). */
  function ensureChecks() {
    return Promise.all(PRESETS.map(presetId => ensureCheck(presetId)))
  }

  /** Whether one preset may currently be fused. */
  function usable(presetId) {
    return PRESETS.includes(presetId) && modeIssues(presetId).length === 0
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
        return undefined // scope chain not readable; leave the agent untouched
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
   * @param agent - the target agent.
   */
  function syncMinimalShadow(agent) {
    if (!state.enabled || state.fusedMinimal === null) {
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
          // 结构化工具注册在子代理 scope，不能只查询全局工具目录。
          const hasStructured = context?.agent?.ctx?.tools
            ?.schemas?.(context.agent)
            ?.some(tool => tool.name === 'structured_output') === true
          return hasStructured
            ? fusedMinimalPrompt(ANCHORS.structuredOutputFull)
            : (state.fusedMinimal ?? fusedMinimalPrompt())
        },
      })
    } catch (error) {
      // 原生委派角色已占用同一名称；保留调用方贡献，在组装时融合。
      if (messageOf(error) !== 'prompt section "deployment:persona-prefix" is already registered in this scope') throw error
      state.customMinimal.add(agent)
      return
    }
    state.shadows.set(agent, dispose)
    state.fusedText.set('minimal', state.fusedMinimal)
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

  function onEnable() {
    void ensureChecks() // fills the status surface in the background
    // The sweep only needs minimal's own check — don't gate it on the rest.
    void ensureCheck('minimal').then(() => {
      sweepAgents()
      notify()
    })
    notify()
  }

  function onDisable() {
    clearShadows()
    state.fusedText.clear()
    notify()
  }

  /** Current card view: toggle and per-preset state. */
  function statusPayload() {
    const modes = {}
    for (const presetId of PRESETS) {
      const issues = modeIssues(presetId)
      modes[presetId] = {
        state: !state.enabled
          ? 'off'
          : !state.startup.has(presetId)
            ? 'checking'
            : issues.length > 0 ? 'failed' : 'active',
        issues,
      }
    }
    return { enabled: state.enabled, contract: contractFingerprint(), modes }
  }

  /** One line-count/byte summary so the preview does not ship a whole prompt. */
  function summarize(text) {
    return {
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      lines: text.split('\n').length,
    }
  }

  /**
   * Variables to bind in a standing-scope preview. The standing scope carries
   * no agent, so its `{{model}}` / `{{cwd}}` providers resolve to nothing; when
   * a live agent exists, borrow its route and working directory so the card
   * reads a realistic prompt instead of raw slots. Absent any agent the slots
   * stay literal, which the card renders as-is.
   * @returns partial variable overrides for the preview assembly.
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
   * live fusion uses. This is the "look before you switch" surface: exact
   * fused prompt text, its size, and the contract fingerprint it embeds.
   * Read-only — it never mutates prompt state.
   * @param presetId - preset id from the card.
   * @returns the preview payload, or a message naming why none is available.
   */
  async function previewFor(presetId) {
    const contract = contractFingerprint()
    if (!PRESETS.includes(presetId)) {
      return { presetId, contract, available: false, reason: `unknown preset "${presetId}"` }
    }
    // Best source first: the exact bytes a top-level live agent just received.
    // Only when no top-level agent has assembled this preset yet does the
    // preview fall back to the standing scope, which carries no agent-bound
    // sections and leaves {{model}} / {{cwd}} as literal slots.
    const cached = state.fusedText.get(presetId)
    if (cached !== undefined) {
      return { presetId, contract, available: true, source: 'live', ...summarize(cached) }
    }
    try {
      const assembly = await presetAssembly(presetId)
      const fused = presetId === 'minimal'
        ? { sections: [{ name: 'deployment:persona-prefix', text: fusedMinimalPrompt() }] }
        : fuseSections(assembly.sections, presetId)
      if (fused.issues !== undefined) {
        return { presetId, contract, available: false, reason: fused.issues.join('; ') }
      }
      const variables = { ...assembly.variables, ...previewVariables() }
      if (renderPrompt === undefined) {
        // Fusion itself needs no renderer; only this preview text does.
        return { presetId, contract, available: false, reason: 'preview needs @deepseek-ai/dsh-system-prompt, which this host does not expose' }
      }
      const text = renderPreview({ ...assembly, sections: fused.sections, variables }, renderPrompt)
      return { presetId, contract, available: true, source: 'standing', ...summarize(text) }
    } catch (error) {
      return { presetId, contract, available: false, reason: `preview probe failed: ${messageOf(error)}` }
    }
  }

  /** Re-run every anchor check from scratch (card endpoint and native panel). */
  async function recheckAll() {
    state.checking.clear()
    state.startup.clear()
    state.runtime.clear()
    state.fusedText.clear()
    await ensureChecks()
    if (state.enabled) sweepAgents()
    notify()
    return statusPayload()
  }

  /**
   * Locate this plugin's own loader entry, so the native panel can write the
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

  /** RPC endpoint handler for the settings card. */
  async function handleRpc(endpoint, payload) {
    switch (endpoint) {
      case 'status': {
        if (state.enabled) await ensureChecks()
        return ok(statusPayload())
      }
      case 'preview': {
        // Private channels forward the client payload verbatim; accept the
        // `{ args }` envelope too so this handler survives a caller that
        // follows the gateway convention.
        const presetId = payload?.presetId ?? payload?.args?.presetId
        return ok(await previewFor(presetId))
      }
      case 'recheck': {
        return ok(await recheckAll())
      }
      default:
        return { ok: false, error: { code: 'internal', message: `dsh-unrestricted: unknown endpoint ${JSON.stringify(endpoint)}`, details: {} } }
    }
  }

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const original = await next()
    if (!state.enabled) return original
    const agent = context.agent
    if (agent === undefined) return original
    const presetId = resolveAgentPreset(agent, original.sections)
    if (presetId === undefined || !PRESET_RULES[presetId]) {
      unshadowMinimal(agent)
      return original
    }
    if (presetId === 'minimal') {
      // If the minimal shadow is already installed on this agent, `assemble()`
      // will restore the complete persona right after the waterfall returns;
      // record the live preview text and let it finish.
      if (state.shadows.has(agent) && state.fusedMinimal !== null) {
        state.fusedText.set('minimal', state.fusedMinimal)
        return original
      }
      // An agent missed by the enable sweep (a request that raced the toggle)
      // registers its shadow now for subsequent assemblies, and also returns
      // the fused minimal section for this assembly when possible.
      await ensureCheck('minimal')
      syncMinimalShadow(agent)
      if (state.customMinimal.has(agent) && usable('minimal')) {
        const fused = fuseSections(original.sections, 'minimal', { isSubagent: true })
        if (fused.issues !== undefined) {
          state.runtime.set('minimal', fused.issues)
          return original
        }
        return { ...original, sections: fused.sections }
      }
      return original
    }
    // If this blank session was previously `minimal` and switched to another
    // preset before its first turn, drop the stale minimal shadow now so it
    // cannot overwrite the new preset's sections after the waterfall.
    if (state.shadows.has(agent)) {
      unshadowMinimal(agent)
    }
    if (!usable(presetId)) return original
    const isSubagent = original.contexts.some(entry => entry.name === 'subagent:delegation')
    const fused = fuseSections(original.sections, presetId, { isSubagent })
    if (fused.issues !== undefined) {
      state.runtime.set(presetId, fused.issues)
      return original
    }
    // Keep the deployed top-level fusion available for the card's preview.
    // Subagents may carry custom personas or restricted sections, so they do
    // not overwrite the preset's top-level preview cache.
    if (!isSubagent && renderPrompt !== undefined) {
      try {
        state.fusedText.set(presetId, renderPreview({ ...original, sections: fused.sections }, renderPrompt))
      } catch {
        state.fusedText.delete(presetId) // an unresolvable variable only costs the preview
      }
    }
    return { ...original, sections: fused.sections }
  })

  ctx.on('agent/created', ({ agent }) => {
    if (!state.enabled) return
    // Only minimal's own check gates the shadow — never the other presets'.
    void ensureCheck('minimal').then(() => syncMinimalShadow(agent))
  })

  ctx.on('agent-preset/selected', (sessionId) => {
    const agent = ctx.get('agents')?.get?.(sessionId)
    if (agent === undefined) return
    state.customMinimal.delete(agent)
    if (!state.enabled) {
      unshadowMinimal(agent)
      return
    }
    void ensureCheck('minimal').then(() => syncMinimalShadow(agent))
  })

  ctx.on('agent/disposed', ({ agent }) => {
    state.customMinimal.delete(agent)
    unshadowMinimal(agent)
  })

  ctx.effect(() => {
    const unwatch = ctx.on('loader/volatile-update', () => {
      const enabled = readEnabled(config)
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

  // Web 状态通道由官方 Connection 认证；headless 组合无需提供 connection 服务。
  ctx.inject(['connection'], (connectionCtx) => {
    const disposeRpc = connectionCtx.connection.rpc.handle(RPC_CHANNEL, handleRpc)
    return async () => {
      await disposeRpc()
    }
  })

  // DSH Go（Android）原生界面：状态条 + 面板 + 面板里的开关。只在带 dsh-go
  // 桥接的主机生效，桌面网页版与 headless 完全不受影响。
  installMobile(ctx, {
    getSnapshot: statusPayload,
    subscribe,
    setEnabled,
    recheck: recheckAll,
  })
}
