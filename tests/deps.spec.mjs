// The host half must load on a host that keeps the engine packages out of its
// reach (a link install outside the profile, a headless composition, the plugin
// kit's isolated `--load`). These tests pin that contract and the fallback
// config schema that makes it possible.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { fallbackSchema } from '../src/deps.js'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('engine dependencies', () => {
  it('loads src/node.js with no engine package resolvable', () => {
    const script = "const m = await import('./src/node.js'); console.log(typeof m.apply, typeof m.Config['~standard'].validate)"
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      env: { ...process.env, DSH_UNRESTRICTED_NO_ENGINE: '1' },
      encoding: 'utf8',
    })
    assert.equal(out.trim(), 'function function')
  })

  it('falls back to a standard-schema config that still answers config.get()', () => {
    const Config = fallbackSchema
      .object({ enabled: fallbackSchema.boolean().default(false) })
      .default({ enabled: false })
      .volatile()
    assert.deepEqual(Config['~standard'].validate({ enabled: true }).value.get(), { enabled: true })
    assert.deepEqual(Config['~standard'].validate(undefined).value.get(), { enabled: false })
    assert.deepEqual(Config['~standard'].validate(null).value.get(), { enabled: false })
    assert.ok(Config['~standard'].validate({ enabled: 'yes' }).issues, 'a non-boolean must be rejected')
    assert.ok(Config['~standard'].validate([]).issues, 'a non-object must be rejected')
    assert.deepEqual(Config.simplify({ enabled: true }), { enabled: true })
  })
})
