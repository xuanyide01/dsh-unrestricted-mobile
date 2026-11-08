/**
 * dsh-go (Android) native surface for the unrestricted mode: the view/data
 * builders. Pure functions of the status snapshot, so the app-facing shapes can
 * be unit-tested without a host, a bridge, or the DSH engine.
 *
 * The app renders these JSON views with its own widgets; nothing here executes
 * on the phone. See dsh-go's plugin docs for the component set and limits
 * (panel title <= 16 chars, actions <= 4, view <= 32 KiB).
 *
 * @module dsh-unrestricted/mobile-view
 */

/** One preset's row label, both locales. */
const PRESET_TEXT = {
  standard: { zh: '标准模式', en: 'Standard' },
  ptc: { zh: 'PTC 模式', en: 'PTC' },
  cordis: { zh: 'Cordis 模式', en: 'Cordis' },
  minimal: { zh: '最小模式', en: 'Minimal' },
}

/** Wording for the fusion states the host reports. */
const STATE_TEXT = {
  off: { zh: '已关闭', en: 'Off', tone: 'muted' },
  checking: { zh: '检测中', en: 'Checking', tone: 'info' },
  active: { zh: '已注入', en: 'Active', tone: 'good' },
  failed: { zh: '未注入', en: 'Not fused', tone: 'bad' },
}

const WORDS = {
  zh: {
    title: '破限',
    switch: '破限开关',
    on: '已开启',
    off: '已关闭',
    version: '插件版本',
    lastRun: '最近装配',
    modes: '适用模式',
    enable: '开启破限',
    disable: '关闭破限',
    recheck: '重新检测',
    hint: '开启后从下一轮对话起生效；关闭即恢复官方提示词。',
    issue: (text) => `该预设缺少 persona 段，已跳过注入（${text}）`,
    noHost: '引擎未提供状态接口',
    toggleOn: '已开启破限',
    toggleOff: '已关闭破限',
    toggleFailed: '开关未生效，请到插件详情页设置',
    rechecked: '已重新检测',
    lastRunNever: '未检测',
    lastRunText: (preset) => `${preset} · 已注入`,
    stripOn: (ready, total) => `破限 开 · ${ready}/${total}`,
    stripOff: '破限 关',
    stripFailed: '破限 注入异常',
  },
  en: {
    title: 'Unrestricted',
    switch: 'Unrestricted mode',
    on: 'On',
    off: 'Off',
    version: 'Version',
    lastRun: 'Last assembly',
    modes: 'Presets',
    enable: 'Enable',
    disable: 'Disable',
    recheck: 'Re-check',
    hint: 'Takes effect from the next turn; off restores the stock prompt.',
    issue: (text) => `This preset has no persona section, so fusion was skipped (${text})`,
    noHost: 'The engine exposes no status surface',
    toggleOn: 'Unrestricted mode on',
    toggleOff: 'Unrestricted mode off',
    toggleFailed: 'Switch failed — use the plugin settings page',
    rechecked: 'Re-checked',
    lastRunNever: 'Not yet',
    lastRunText: (preset) => `${preset} · fused`,
    stripOn: (ready, total) => `Unrestricted · ${ready}/${total}`,
    stripOff: 'Unrestricted · off',
    stripFailed: 'Unrestricted · fusion issue',
  },
}

/**
 * Pick the wording for a locale tag; anything not English reads as Chinese.
 * @param {string | undefined} locale - the app's locale, e.g. `zh-Hans` / `en`.
 * @returns {typeof WORDS.zh} the word table.
 */
export function words(locale) {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? WORDS.en : WORDS.zh
}

/**
 * Count presets whose fusion is live.
 * @param {{modes?: Record<string, {state: string}>}} snapshot - host status.
 * @returns {{ready: number, total: number}} fused presets over known presets.
 */
export function readiness(snapshot) {
  const modes = snapshot?.modes ?? {}
  const ids = Object.keys(modes)
  return {
    ready: ids.filter((id) => modes[id]?.state === 'active').length,
    total: ids.length,
  }
}

/** First issue across every preset, or undefined when all presets fused. */
function firstIssue(snapshot) {
  for (const id of Object.keys(snapshot?.modes ?? {})) {
    const issue = snapshot.modes[id]?.issues?.[0]
    if (typeof issue === 'string' && issue !== '') return issue
  }
  return undefined
}

/** Wording for the last top-level assembly the host half observed. */
function lastRunText(last, w) {
  const preset = typeof last?.presetId === 'string' && last.presetId !== '' ? last.presetId : undefined
  if (preset === undefined) return w.lastRunNever
  return last?.fused === false ? w.lastRunText(preset).replace(/ · .*$/, ' · 未注入') : w.lastRunText(preset)
}

/**
 * The status-strip line: one glance, at most 24 characters.
 * @param {object} snapshot - host status payload.
 * @param {string} [locale] - app locale.
 * @returns {{text: string, icon: string, tone?: string}} strip payload.
 */
export function stripData(snapshot, locale) {
  const w = words(locale)
  if (snapshot?.enabled !== true) return { text: w.stripOff, icon: 'bolt' }
  const { ready, total } = readiness(snapshot)
  if (firstIssue(snapshot) !== undefined) {
    return { text: w.stripFailed, icon: 'bolt', tone: 'bad' }
  }
  return { text: w.stripOn(ready, total), icon: 'bolt', tone: 'good' }
}

/**
 * One preset row for the panel list.
 * @param {string} presetId - standard / ptc / cordis / minimal.
 * @param {{state: string, issues: string[]}} state - per-preset host state.
 * @param {typeof WORDS.zh} w - word table.
 */
function presetRow(presetId, state, w) {
  const label = PRESET_TEXT[presetId]
  const wording = STATE_TEXT[state?.state] ?? STATE_TEXT.checking
  return {
    title: label === undefined ? presetId : label[w === WORDS.en ? 'en' : 'zh'],
    trailing: wording[w === WORDS.en ? 'en' : 'zh'],
    icon: 'plugin',
    tone: wording.tone === 'muted' ? undefined : wording.tone,
  }
}

/**
 * Build the native panel view from a live snapshot.
 *
 * Every string is resolved here, so the app never needs a second round trip:
 * a tap on 开启/关闭 returns `refresh`, and the app asks for this view again.
 * @param {object | undefined} snapshot - host status payload from the node half.
 * @param {string} [locale] - app locale.
 * @returns {object} a dsh-go view (JSON-serialisable).
 */
export function panelView(snapshot, locale) {
  const w = words(locale)
  if (snapshot === undefined || snapshot === null) {
    // `callout` + `actions` exist in every protocol v1 component set; the
    // richer `emptyState` control does not, and an unknown node would cost the
    // whole panel on an older app.
    return {
      type: 'stack',
      title: w.title,
      children: [
        { type: 'callout', tone: 'warn', text: w.noHost },
        { type: 'actions', items: [{ label: w.recheck, action: 'recheck', icon: 'refresh' }] },
      ],
    }
  }
  const enabled = snapshot.enabled === true
  const { ready, total } = readiness(snapshot)
  const issue = firstIssue(snapshot)
  const version = typeof snapshot.version === 'string' && snapshot.version !== '' ? snapshot.version : '—'
  const children = [
    {
      type: 'row',
      children: [
        { type: 'metric', label: w.switch, value: enabled ? w.on : w.off, tone: enabled ? 'good' : 'info' },
        { type: 'metric', label: w.modes, value: `${ready}/${total}`, tone: issue === undefined ? 'good' : 'warn' },
      ],
    },
    {
      type: 'keyValue',
      items: [
        { label: w.version, value: version },
        { label: w.lastRun, value: lastRunText(snapshot.lastAssembly, w) },
      ],
    },
    {
      type: 'list',
      items: Object.keys(snapshot.modes ?? {}).map(id => presetRow(id, snapshot.modes[id], w)),
    },
  ]
  if (issue === undefined) {
    children.push({ type: 'text', text: w.hint, tone: 'muted' })
  } else {
    children.push({ type: 'callout', tone: 'warn', text: w.issue(issue).slice(0, 200) })
  }
  children.push({
    type: 'actions',
    items: [
      { label: enabled ? w.disable : w.enable, action: 'toggle', icon: 'bolt', style: 'primary' },
      { label: w.recheck, action: 'recheck', icon: 'refresh' },
    ],
  })
  return { type: 'stack', children }
}

/**
 * Locale-resolved toast text for one panel action outcome.
 * @param {'toggle' | 'recheck'} action - the tapped action id.
 * @param {{ok: boolean, enabled?: boolean}} result - outcome from the host half.
 * @param {string} [locale] - app locale.
 */
export function actionToast(action, result, locale) {
  const w = words(locale)
  if (action === 'recheck') return result.ok ? w.rechecked : w.toggleFailed
  if (!result.ok) return w.toggleFailed
  return result.enabled === true ? w.toggleOn : w.toggleOff
}
