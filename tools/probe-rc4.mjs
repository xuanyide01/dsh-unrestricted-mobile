#!/usr/bin/env node
/**
 * Live verification against the DSH engine that ships inside the DSH Go app.
 *
 * Boots the installed `@deepseek-ai/dsh` (the version pinned by the app's
 * runtime, 0.2.1-rc.4) with the same bundles the phone's `web` profile runs,
 * assembles the real system prompt of every preset, and then boots the same
 * composition WITH this plugin installed to prove the fusion lands on that
 * engine — anchors, section order, byte size — without calling a model.
 *
 * Nothing is written outside the given root. Usage:
 *   node tools/probe-rc4.mjs --root <dir-with-@deepseek-ai/dsh-installed> [--out <dir>]
 */
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) {
    if (fallback !== undefined) return fallback
    throw new Error(`missing --${name} <value>`)
  }
  return process.argv[index + 1]
}

const root = resolve(arg('root'))
const out = resolve(arg('out', join(root, 'probe-out')))
const PLUGIN = 'dsh-unrestricted'

// Everything this probe boots writes under the given root: home paths, sessions,
// credentials and caches. Never the user's real ~/.dsh.
process.env.DSH_HOME = join(root, 'probe-run', 'home')
process.env.DSH_TELEMETRY_DISABLED = '1'
mkdirSync(process.env.DSH_HOME, { recursive: true })

const require = createRequire(join(root, 'package.json'))

async function load(specifier) {
  return import(pathToFileURL(require.resolve(specifier)).href)
}

const appBoot = await load('@deepseek-ai/dsh-app-boot')
const cmdline = await load('@deepseek-ai/dsh-cmdline')
const { SessionId } = await load('@deepseek-ai/dsh-session')
const { renderPrompt } = await load('@deepseek-ai/dsh-system-prompt')
const { applyChildComposition, childSessionMeta } = await load('@deepseek-ai/dsh-subagent')

const dshVersion = JSON.parse(readFileSync(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version
const BASE_PATCH = require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')
const WEB_DIR = resolve(join(root, 'node_modules/@deepseek-ai/dsh-web-app'))
const INSTALL_ANCHOR = join(root, 'package.json')

/** One temporary home per run, always inside the workspace root. */
function makeHome(label) {
  const home = join(root, 'probe-run', label)
  rmSync(home, { recursive: true, force: true })
  mkdirSync(join(home, 'workspace'), { recursive: true })
  return home
}

/** The rows the phone's web profile runs, minus anything that touches the network. */
function overrides(home) {
  return [
    { id: 'storage-json', config: { root: join(home, 'storages') } },
    { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
    { id: 'webserver', inject: [], config: { host: '127.0.0.1', port: 0 } },
    { id: 'web-runtime', disabled: true },
    { id: 'hmr', disabled: true },
    { id: 'client-hmr', disabled: true },
    { id: 'modules', disabled: true },
    { id: 'connection', inject: ['webServer'], config: { trustedHosts: [] } },
    { id: 'agent-preset-registry', config: { default: 'standard' } },
  ]
}

async function boot({ home, label, withPlugin }) {
  const profileDir = join(home, 'profiles', label)
  mkdirSync(profileDir, { recursive: true })
  appBoot.initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  const profile = {
    name: label, dir: profileDir, layers: [],
    patchPath: join(profileDir, 'cordis.patch.yml'), patches: [], skippedBundles: [],
  }
  const resolution = await appBoot.createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, home, profile })
  const rootConfig = join(profileDir, 'cordis.yml')
  writeFileSync(rootConfig, '[]\n')
  const webManifest = JSON.parse(readFileSync(join(WEB_DIR, 'package.json'), 'utf8'))
  const webPatches = appBoot.bundlePatchPaths(WEB_DIR, webManifest.dsh.bundle)
    .flatMap(path => appBoot.loadOverlayPatches('dsh-probe', path))
  const patches = [
    ...appBoot.loadOverlayPatches('dsh-probe', BASE_PATCH),
    ...webPatches,
    ...overrides(home),
  ]
  if (withPlugin) {
    patches.push({ insert: [{ id: PLUGIN, name: PLUGIN, config: { enabled: true } }] })
  }
  return await appBoot.boot('dsh-probe', rootConfig, patches, async (bootCtx) => {
    bootCtx.provide('profileContext', {
      name: label, dir: profileDir, patchPath: profile.patchPath,
      installAnchor: INSTALL_ANCHOR, home, cwd: home,
      startedBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      overlays: [], telemetryDisabledEnv: '1',
    })
    await bootCtx.plugin(appBoot.PluginPackages, { resolution })
    cmdline.provideCmdline(bootCtx, { args: [], exit: () => {} })
  })
}

async function dump(ctx, label, presetId, { plan = false } = {}) {
  const workspace = join(root, 'probe-run', 'workspace')
  mkdirSync(workspace, { recursive: true })
  const handle = await ctx.agents.create({
    sessionId: SessionId(`probe-${label}-${presetId}${plan ? '-plan' : ''}`),
    meta: { cwd: workspace },
    agentOptions: { provider: 'deepseek', model: 'deepseek-chat' },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, presetId).then(() => undefined),
  })
  try {
    // Plan mode is a session fact, exactly as the app switches it.
    if (plan) handle.agent.session.append('plan/mode', { active: true })
    const assembly = await ctx.systemPrompt.assemble({ agent: handle.agent, scope: handle.agent })
    const text = renderPrompt(assembly)
    return {
      text,
      sections: assembly.sections.map(section => ({ name: section.name, text: section.text })),
      tools: assembly.tools.map(tool => tool.name),
      bytes: Buffer.byteLength(text, 'utf8'),
    }
  } finally {
    await handle.dispose()
  }
}

mkdirSync(out, { recursive: true })

// Stage this package where the loader can resolve its bare imports, exactly as
// it sits in the phone's profile node_modules.
const staged = join(root, 'node_modules', PLUGIN)
rmSync(staged, { recursive: true, force: true })
// `--package` lets the probe boot the built bundle instead of the working copy.
const pkgDir = resolve(arg('package', fileURLToPath(new URL('..', import.meta.url))))
if (process.argv.includes('--link')) {
  // Reproduce the DSH Go install: a symlink in the profile pointing at a
  // directory that lives outside it (/root/.dsh/dsh-go/plugins/...).
  symlinkSync(pkgDir, staged, 'junction')
  console.log(`linked ${staged} -> ${pkgDir}`)
} else {
  cpSync(pkgDir, staged, {
    recursive: true,
    filter: source => !/[\\/](node_modules|\.git|tests|tools|dist)([\\/]|$)/.test(source.slice(staged.length)),
  })
}

const report = { dshVersion, presets: {} }

const plainHome = makeHome('plain')
const plain = await boot({ home: plainHome, label: 'plain', withPlugin: false })
for (const presetId of ['standard', 'ptc', 'cordis', 'minimal']) {
  const dumped = await dump(plain, 'plain', presetId)
  writeFileSync(join(out, `original-${presetId}.md`), dumped.text)
  report.presets[presetId] = { original: { bytes: dumped.bytes, sections: dumped.sections.map(s => s.name) } }
  if (presetId !== 'minimal') {
    const planning = await dump(plain, 'plain', presetId, { plan: true })
    writeFileSync(join(out, `original-${presetId}-plan.md`), planning.text)
    report.presets[presetId].originalPlan = { bytes: planning.bytes }
  }
}
await plain.fiber.dispose()

const fusedHome = makeHome('fused')
const fused = await boot({ home: fusedHome, label: 'fused', withPlugin: true })
for (const presetId of ['standard', 'ptc', 'cordis', 'minimal']) {
  const dumped = await dump(fused, 'fused', presetId)
  writeFileSync(join(out, `fused-${presetId}.md`), dumped.text)
  const block = dumped.sections.find(section => section.name === 'unrestricted:execution-mode')
  report.presets[presetId].fused = {
    bytes: dumped.bytes,
    sections: dumped.sections.map(s => s.name),
    hasBlock: block !== undefined,
    blockBytes: block === undefined ? 0 : Buffer.byteLength(block.text, 'utf8'),
  }
  if (presetId !== 'minimal') {
    const planning = await dump(fused, 'fused', presetId, { plan: true })
    writeFileSync(join(out, `fused-${presetId}-plan.md`), planning.text)
    report.presets[presetId].fusedPlan = {
      bytes: planning.bytes,
      hasBlock: planning.sections.some(section => section.name === 'unrestricted:execution-mode'),
      // The plan note must survive the render, not just the section list.
      hasPlanNote: planning.text.includes('Plan mode restricts delivery'),
    }
  }
}
// The panel/status surface must see the same toggle the assembly obeyed.
report.status = fused.get(PLUGIN) === undefined ? null : 'mounted'
report.pluginStatus = fused.get('unrestricted') ?? null
await fused.fiber.dispose()

writeFileSync(join(out, 'probe.json'), JSON.stringify(report, null, 2) + '\n')
for (const [presetId, entry] of Object.entries(report.presets)) {
  const delta = entry.fused === undefined ? 'n/a' : entry.fused.bytes - entry.original.bytes
  console.log(`${presetId}: original ${entry.original.bytes}B -> fused ${entry.fused?.bytes ?? '?'}B (delta ${delta}), block=${entry.fused?.hasBlock}`)
}
console.log(`dsh ${dshVersion}; report at ${join(out, 'probe.json')}`)
process.exit(0)
