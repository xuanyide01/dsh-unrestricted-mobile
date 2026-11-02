// dsh-go (Android) surface tests: the package manifest, the pure view/data
// builders, and the bridge wiring. No DSH host, bridge, or phone required —
// the app-facing shapes are plain JSON, so they can be asserted here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { installMobile, PANEL_ID, STRIP_ID } from '../src/mobile.js'
import { actionToast, panelView, readiness, stripData, words } from '../src/mobile-view.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(`${root}package.json`, 'utf8'))

/** A snapshot shaped like the node half's `statusPayload()`. */
function snapshot({ enabled = true, states = {} } = {}) {
  const modes = {}
  for (const id of ['standard', 'ptc', 'cordis', 'minimal']) {
    const state = states[id] ?? (enabled ? 'active' : 'off')
    modes[id] = { state, issues: state === 'failed' ? [`${id}: persona anchor moved`] : [] }
  }
  return { enabled, version: '0.2.6-mobile.5', update: { state: 'idle' }, modes }
}

describe('dsh-go manifest', () => {
  it('declares a v1 manifest with a strip and a panel', () => {
    const go = manifest.dshGo
    assert.equal(go.v, 1)
    assert.ok(go.title.zh && go.title.en, 'title needs both locales')
    assert.equal(go.contributes['composer.strip'].length, 1)
    assert.equal(go.contributes.panels.length, 1)
  })

  it('uses the ids the host half registers, and the strip opens the panel', () => {
    const go = manifest.dshGo
    assert.equal(go.contributes['composer.strip'][0].id, STRIP_ID)
    assert.equal(go.contributes.panels[0].id, PANEL_ID)
    assert.equal(go.contributes['composer.strip'][0].panel, PANEL_ID)
  })

  it('puts one tap-to-toggle capsule over the input box', () => {
    const go = manifest.dshGo
    const actions = go.contributes['composer.actions']
    assert.equal(actions.length, 1)
    assert.equal(actions[0].id, 'toggle')
    for (const label of [actions[0].label.zh, actions[0].label.en]) {
      assert.ok(label.length <= 10, `label too long: ${label}`)
    }
  })

  it('keeps every slot id unique and inside the documented charset', () => {
    const go = manifest.dshGo
    const ids = [
      ...go.contributes['composer.actions'].map(row => row.id),
      ...go.contributes['composer.strip'].map(row => row.id),
      ...go.contributes.panels.map(row => row.id),
    ]
    assert.equal(new Set(ids).size, ids.length)
    for (const id of ids) assert.match(id, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/)
  })

  it('stays under the 16 KiB manifest budget', () => {
    assert.ok(Buffer.byteLength(JSON.stringify(manifest.dshGo), 'utf8') <= 16 * 1024)
  })

  it('advertises a DSH range that includes the engine inside DSH Go', () => {
    // The app ships DSH 0.2.1-rc.4; the desktop app runs 0.2.1-rc.5.
    assert.match(manifest.engines.dsh, /^>=0\.2\.1-rc\.2/)
    assert.match(manifest.engines.dsh, /<0\.2\.3-0\s*$/)
  })
})

describe('locale', () => {
  it('reads as Chinese unless the app asks for English', () => {
    assert.equal(words('zh-Hans'), words('zh'))
    assert.equal(words('en-US'), words('en'))
    assert.notEqual(words('en').stripOff, words('zh').stripOff)
  })
})

describe('readiness', () => {
  it('counts presets whose fusion is live', () => {
    assert.deepEqual(readiness(snapshot()), { ready: 4, total: 4 })
    assert.deepEqual(readiness(snapshot({ states: { ptc: 'failed', minimal: 'checking' } })), { ready: 2, total: 4 })
  })
})

describe('status strip', () => {
  it('says off, on, and anchor issue in one short line', () => {
    assert.equal(stripData(snapshot({ enabled: false }), 'zh').text, '破限 关')
    assert.equal(stripData(snapshot(), 'zh').text, '破限 开 · 4/4')
    assert.equal(stripData(snapshot({ states: { standard: 'failed' } }), 'zh').text, '破限 注入异常')
  })

  it('stays inside the 24-character strip budget', () => {
    for (const text of [stripData(snapshot(), 'zh'), stripData(snapshot(), 'en'), stripData(snapshot({ enabled: false }), 'en')]) {
      assert.ok(text.text.length <= 24, `too long: ${text.text}`)
      assert.ok(typeof text.icon === 'string')
    }
  })
})

describe('panel view', () => {
  it('shows the switch, the preset count, the version and every preset', () => {
    const view = panelView(snapshot(), 'zh')
    assert.equal(view.type, 'stack')
    const metrics = view.children.find(child => child.type === 'row')
    assert.equal(metrics.children.length, 2)
    assert.equal(metrics.children[0].value, '已开启')
    assert.equal(metrics.children[1].value, '4/4')
    const list = view.children.find(child => child.type === 'list')
    assert.equal(list.items.length, 4)
    assert.deepEqual(list.items.map(row => row.title), ['标准模式', 'PTC 模式', 'Cordis 模式', '最小模式'])
    assert.equal(list.items[0].trailing, '已注入')
  })

  it('offers the opposite toggle, a re-check and an update check', () => {
    const on = panelView(snapshot(), 'zh').children.at(-1)
    assert.equal(on.type, 'actions')
    assert.deepEqual(on.items.map(item => item.action), ['toggle', 'recheck', 'check-update'])
    assert.equal(on.items[0].label, '关闭破限')
    assert.equal(on.items[0].style, 'primary')
    const off = panelView(snapshot({ enabled: false }), 'zh').children.at(-1)
    assert.equal(off.items[0].label, '开启破限')
  })

  it('surfaces a skipped preset instead of pretending the mode is live', () => {
    const view = panelView(snapshot({ states: { ptc: 'failed' } }), 'zh')
    const callout = view.children.find(child => child.type === 'callout')
    assert.equal(callout.tone, 'warn')
    assert.match(callout.text, /缺少 persona/)
    assert.equal(view.children.at(-1).type, 'actions')
  })

  it('degrades to protocol-v1 components when the host exposes no status', () => {
    const view = panelView(undefined, 'zh')
    // `emptyState` is a newer control; an app that does not know it would drop
    // the whole view, so the fallback uses callout + actions.
    assert.equal(view.children[0].type, 'callout')
    assert.equal(view.children.at(-1).type, 'actions')
    assert.ok(view.children.every(child => ['callout', 'actions'].includes(child.type)))
  })

  it('is JSON-serialisable and inside the 40-node view budget', () => {
    const view = panelView(snapshot(), 'zh')
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(view)))
    const count = JSON.stringify(view).match(/\"type\"/g)?.length ?? 0
    assert.ok(count <= 40, `view has ${count} nodes`)
  })
})

describe('action toast', () => {
  it('confirms a toggle in the app language', () => {
    assert.equal(actionToast('toggle', { ok: true, enabled: true }, 'zh'), '已开启破限')
    assert.equal(actionToast('toggle', { ok: true, enabled: false }, 'en'), 'Unrestricted mode off')
    assert.equal(actionToast('recheck', { ok: true }, 'zh'), '已重新检测')
    assert.match(actionToast('toggle', { ok: false }, 'zh'), /插件详情页/)
  })
})

describe('bridge wiring', () => {
  /** Fake ctx: `inject(['dshGo'])` fires immediately with a recording bridge. */
  function harness(snapshotValue) {
    const registered = { panels: new Map(), strips: new Map(), handlers: new Map() }
    const go = {
      on(id, handler) {
        registered.handlers.set(id, handler)
        return () => registered.handlers.delete(id)
      },
      panel(id, options) {
        registered.panels.set(id, options)
        return () => registered.panels.delete(id)
      },
      strip(id, dataFn) {
        registered.strips.set(id, dataFn)
        return () => registered.strips.delete(id)
      },
    }
    const calls = []
    const controller = {
      getSnapshot: () => snapshotValue,
      subscribe: () => () => {},
      setEnabled: async (next) => { calls.push(next); snapshotValue.enabled = next; return true },
      recheck: async () => { calls.push('recheck'); return snapshotValue },
    }
    const ctx = { inject: (services, call) => { call({ dshGo: go }) } }
    installMobile(ctx, controller)
    return { registered, calls }
  }

  it('registers the declared panel and strip ids', () => {
    const { registered } = harness(snapshot())
    assert.ok(registered.panels.has(PANEL_ID))
    assert.ok(registered.strips.has(STRIP_ID))
  })

  it('answers the input-box capsule with a toggle and a toast', async () => {
    const { registered, calls } = harness(snapshot({ enabled: false }))
    const handler = registered.handlers.get('toggle')
    assert.equal(typeof handler, 'function')
    const result = await handler({}, { surface: 'composer.actions', id: 'toggle', locale: 'zh' })
    assert.deepEqual(calls, [true])
    assert.equal(result.toast, '已开启破限')
  })

  it('flips the toggle through the controller and asks for a repaint', async () => {
    const { registered, calls } = harness(snapshot({ enabled: false }))
    const result = await registered.panels.get(PANEL_ID).actions.toggle({}, { locale: 'zh' })
    assert.deepEqual(calls, [true])
    assert.equal(result.toast, '已开启破限')
    assert.equal(result.refresh, PANEL_ID)
  })

  it('re-checks and repaints', async () => {
    const { registered, calls } = harness(snapshot())
    const result = await registered.panels.get(PANEL_ID).actions.recheck({}, { locale: 'en' })
    assert.deepEqual(calls, ['recheck'])
    assert.equal(result.refresh, PANEL_ID)
  })

  it('emits the strip payload and lets go on unsubscribe', () => {
    const { registered } = harness(snapshot())
    const pushes = []
    const release = registered.strips.get(STRIP_ID)({}, (data) => pushes.push(data), { locale: 'zh' })
    assert.equal(pushes.at(-1).text, '破限 开 · 4/4')
    assert.equal(typeof release, 'function')
    release()
  })

  it('does not register anything when the host has no bridge', () => {
    let called = false
    installMobile({ inject: () => {} }, { getSnapshot: () => snapshot() })
    // The inject callback never runs: nothing throws and nothing registers.
    assert.equal(called, false)
  })
})
