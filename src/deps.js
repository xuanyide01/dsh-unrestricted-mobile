/**
 * Engine dependencies, resolved the way the phone's engine actually lays them
 * out — not the way plain Node would.
 *
 * A DSH Go install keeps the engine in `/opt/dsh` (`@deepseek-ai/dsh` plus the
 * 300-odd packages it depends on) and the profile's `node_modules` holds only
 * the plugins. A plugin installed by link (`dsh plugin add <dir>`) therefore
 * cannot see `@deepseek-ai/schemastery` by walking up from its own real path:
 * that path lives outside the profile (`$DSH_HOME/dsh-go/plugins/…`).
 *
 * Inside the engine this still worked because `@deepseek-ai/dsh-app-boot`
 * installs a profile-resolution layer that re-routes bare specifiers of profile
 * plugins to the installation. Anything that imports the module *without* that
 * layer — `node tools/probe-rc4.mjs`, the plugin kit's `check.mjs --load`,
 * `doctor-mobile.sh`, a headless composition, a future runtime with a different
 * loader — sees `ERR_MODULE_NOT_FOUND` and reports the plugin as not running.
 *
 * So the host half never hard-imports an engine package:
 *
 * - {@link resolveEngineModule} probes a few known installation anchors with
 *   `createRequire` and imports what it finds (the real schemastery, the real
 *   renderer, with their real semantics);
 * - when nothing is found, {@link fallbackSchema} is a small standard-schema
 *   object that keeps `enabled` validated and `config.get()` working, and the
 *   prompt renderer simply stays unavailable (it only feeds the preview; the
 *   fusion itself is pure text work in `rules.js`).
 *
 * @module dsh-unrestricted/deps
 */
import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Environment overrides an operator can set when the engine lives elsewhere. */
const ENGINE_HINTS = ['DSH_UNRESTRICTED_ENGINE', 'DSH_ENGINE_ROOT', 'DSH_INSTALL_ROOT']

/**
 * `package.json` paths whose neighbouring `node_modules` may hold the engine.
 * The first two are the DSH Go runtime layout; `process.argv[1]` is the running
 * CLI (`…/@deepseek-ai/dsh/lib/bin.js`), which is how a desktop install points
 * at its own tree.
 * @returns {string[]} absolute file paths, de-duplicated.
 */
function anchors() {
  const list = []
  // `DSH_UNRESTRICTED_NO_ENGINE=1` exercises the fallback on a host that does
  // have an engine (tests do this; nothing else sets it).
  if (process.env.DSH_UNRESTRICTED_NO_ENGINE === '1') return list
  const push = (value) => {
    if (typeof value === 'string' && isAbsolute(value) && !list.includes(value)) list.push(value)
  }
  for (const key of ENGINE_HINTS) push(process.env[key])
  push('/opt/dsh/package.json')
  push('/opt/dsh/node_modules/@deepseek-ai/dsh/package.json')
  push('/opt/dsh')
  push(process.argv?.[1])
  return list
}

/** `createRequire` wants a file to anchor on; turn a directory hint into one. */
function anchorFile(anchor) {
  if (anchor.endsWith('/')) return `${anchor}package.json`
  return /\.(?:mjs|cjs|js|json)$/.test(anchor) ? anchor : `${anchor}/package.json`
}

/**
 * Resolve one bare specifier against the installation anchors.
 * @param {string} name - package specifier, e.g. `@deepseek-ai/schemastery`.
 * @returns {string | undefined} absolute file path, or undefined when no anchor carries it.
 */
export function resolveEngineModule(name) {
  for (const anchor of anchors()) {
    try {
      return createRequire(anchorFile(anchor)).resolve(name)
    } catch {
      // Try the next anchor; the last fallback below covers a normal install.
    }
  }
  try {
    return createRequire(import.meta.url).resolve(name)
  } catch {
    return undefined
  }
}

/** Import an engine package by file path; a broken install reads as absent. */
async function load(name) {
  const file = resolveEngineModule(name)
  if (file === undefined) return undefined
  try {
    return await import(pathToFileURL(file).href)
  } catch {
    return undefined
  }
}

const schemaModule = await load('@deepseek-ai/schemastery')
const promptModule = await load('@deepseek-ai/dsh-system-prompt')

/** The engine's Schemastery, or undefined when this host keeps it out of reach. */
export const z = schemaModule?.default ?? undefined

/** The engine's prompt renderer (preview only), or undefined. */
export const renderPrompt = typeof promptModule?.renderPrompt === 'function' ? promptModule.renderPrompt : undefined

/** What was found, for status/doctor output. */
export const engineDeps = Object.freeze({
  schema: z !== undefined,
  render: renderPrompt !== undefined,
  schemaFile: resolveEngineModule('@deepseek-ai/schemastery'),
})

/** One schema node of the fallback subset (boolean / object only). */
function node(kind, options = {}) {
  const state = { kind, def: options.def, shape: options.shape }
  const api = {
    kind,
    default(value) {
      state.def = value
      return api
    },
    description() {
      return api
    },
    volatile() {
      return api
    },
    simplify(value) {
      return value
    },
    meta: {},
    '~standard': {
      version: 1,
      vendor: 'dsh-unrestricted',
      validate(raw) {
        const checked = normalize(state, raw)
        return checked.issues === undefined ? { value: { get: () => checked.config } } : { issues: checked.issues }
      },
    },
  }
  return api
}

/** Coerce one field by its declared kind; undefined means "wrong type". */
function coerce(declared, value) {
  if (declared?.kind === 'boolean') return typeof value === 'boolean' ? value : undefined
  return value
}

/** Validate a raw config against the fallback schema's node tree. */
function normalize(state, raw) {
  if (state.kind === 'boolean') {
    if (raw === undefined) return { config: state.def ?? false }
    return typeof raw === 'boolean' ? { config: raw } : { issues: [{ message: 'expected a boolean', path: [] }] }
  }
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    return { issues: [{ message: 'config must be an object', path: [] }] }
  }
  const source = raw ?? {}
  const config = { ...(state.def ?? {}) }
  for (const [key, declared] of Object.entries(state.shape ?? {})) {
    if (source[key] === undefined) continue
    const value = coerce(declared, source[key])
    if (value === undefined) return { issues: [{ message: `${key}: expected ${declared?.kind ?? 'a value'}`, path: [key] }] }
    config[key] = value
  }
  return { config }
}

/**
 * A Schemastery-shaped subset used only when the engine's own copy is out of
 * reach: enough for `z.object({...}).default({...}).volatile()` and for
 * Cordis's `Config["~standard"].validate()` / `Config.simplify()`.
 */
export const fallbackSchema = {
  boolean: () => node('boolean'),
  object: (shape) => node('object', { shape }),
}
