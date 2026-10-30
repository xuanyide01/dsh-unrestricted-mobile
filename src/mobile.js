/**
 * dsh-go (Android) host half: exposes the unrestricted mode's live status as a
 * native composer strip and a native panel, and lets the panel flip the same
 * `enabled` config the web card flips.
 *
 * Only loaded when the host carries the dsh-go bridge (`ctx.dshGo`), i.e. the
 * engine bundled with the DSH Go app. The callback is registered through
 * `ctx.inject(['dshGo'])` and never through the plugin's top-level `inject`, so
 * a host without the bridge (desktop web, headless, SSH) simply skips it and the
 * plugin keeps behaving exactly as before.
 *
 * Nothing here changes prompt assembly: the node half still fuses at
 * `system-prompt/assemble`, and this file only reads and writes its toggle.
 *
 * @module dsh-unrestricted/mobile
 */
import { actionToast, panelView, stripData } from './mobile-view.js'

/** Panel id inside this plugin; unique across every slot of the package. */
export const PANEL_ID = 'unrestricted'

/** Composer-strip id inside this plugin. */
export const STRIP_ID = 'status'

/**
 * Register the dsh-go surfaces against a status controller.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} controller - the node half's status surface:
 *   `getSnapshot()`, `subscribe(listener)`, `setEnabled(boolean)`, `recheck()`.
 * @returns {void}
 */
export function installMobile(ctx, controller) {
  ctx.inject(['dshGo'], (goCtx) => {
    const dshGo = goCtx.dshGo
    if (dshGo === undefined || typeof dshGo !== 'object') return

    /** Current snapshot, never throwing into the bridge. */
    const snapshot = () => {
      try {
        return controller.getSnapshot()
      } catch {
        return undefined
      }
    }

    const disposers = []

    if (typeof dshGo.strip === 'function') {
      const strip = dshGo.strip(STRIP_ID, (scope, emit, caps) => {
        const push = () => {
          try {
            emit(stripData(snapshot(), caps?.locale))
          } catch {
            // A malformed snapshot must not cost the plugin a violation.
          }
        }
        push()
        const release = controller.subscribe(push)
        return typeof release === 'function' ? release : () => {}
      })
      if (typeof strip === 'function') disposers.push(strip)
    }

    if (typeof dshGo.panel === 'function') {
      const panel = dshGo.panel(PANEL_ID, {
        view: (scope, caps) => panelView(snapshot(), caps?.locale),
        actions: {
          toggle: async (scope, event) => {
            let ok = false
            try {
              ok = await controller.setEnabled(snapshot()?.enabled !== true) !== false
            } catch {
              ok = false
            }
            const text = actionToast('toggle', { ok, enabled: snapshot()?.enabled === true }, event?.locale)
            return ok ? { toast: text, refresh: PANEL_ID } : { toast: text }
          },
          recheck: async (scope, event) => {
            let ok = true
            try {
              await controller.recheck()
            } catch {
              ok = false
            }
            return { toast: actionToast('recheck', { ok }, event?.locale), refresh: PANEL_ID }
          },
        },
      })
      if (typeof panel === 'function') disposers.push(panel)
    }

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // Disposal races with host shutdown; nothing left to undo.
        }
      }
    }
  })
}
