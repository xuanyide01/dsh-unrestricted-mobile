# dsh-unrestricted · DSH Go port

Prompt-level unrestricted mode for DeepSeek Harness — now working on the **DSH Go** Android client. The desktop/web build keeps its settings card; the phone gets a native status strip, a native panel and a native switch.

- Version: `0.2.6-mobile.2`
- Engine: DSH `>=0.2.1-rc.2 <0.2.3-0` (measured on `0.2.1-rc.4` in the app, `0.2.1-rc.5` on desktop)
- License: MIT

## Credits

This repository is an adaptation of two projects; the rules, the fusion mechanism and the plugin protocol all come from them:

| Repository | Role |
|---|---|
| [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted) | The upstream plugin: unrestricted rules, the `system-prompt/assemble` fusion, anchor checks and the web settings card. This repo is its DSH Go branch |
| [ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go) | The Android client: the on-device engine runtime (DSH `0.2.1-rc.4` + `dsh-go-bridge`), the native plugin protocol (`dshGo` manifest, strip/panels/actions), `plugin-kit` and all plugin docs |

Rules structure and task-routing ideas also follow [Jia-Ethan/codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith) (MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## How it works

DSH assembles a system prompt before every request. The plugin listens on the `system-prompt/assemble` waterfall and fuses one extra section into the preset's **own** prompt — it never replaces the prompt and never touches tool definitions:

- the `unrestricted:execution-mode` section is inserted right after the persona;
- plan mode, PTC (`run_code`) and structured subagents only get a boundary note: those rules constrain delivery format, not content scale;
- switching off returns `next()` verbatim, so the prompt is byte-identical to stock.

Every preset (standard / ptc / cordis / minimal) is checked against the stock anchor text before fusion. A mismatch leaves that preset on the stock prompt and surfaces the failed anchor in the UI.

## Install

### Android (DSH Go)

`dsh plugin add` on the phone is a link install: the plugin directory lives outside the profile. Copy the tarball to the phone's Downloads, then in the **app's own terminal**:

```sh
rm -rf /root/.dsh/dsh-go/plugins/dsh-unrestricted
tar xzf /sdcard/Download/dsh-unrestricted-0.2.6-mobile.2.tgz -C /root/.dsh/dsh-go/plugins/
sh /root/.dsh/dsh-go/plugins/dsh-unrestricted/install-mobile.sh
```

The script stages the directory, runs `dsh plugin --profile web add`, links the profile's `node_modules` into the plugin directory (so link installs resolve their host imports), and finishes with an import self-test printing `OK` or the exact error.

Then use "Plugins → restart kernel to reload" and turn the switch on under `dsh-unrestricted → settings`.

### Desktop / web

```sh
dsh plugin --profile web add github:xuanyide01/dsh-unrestricted-mobile
dsh plugin --profile web add /path/to/dsh-unrestricted   # or from a directory
```

Restart `dsh web` and enable it in the 破限模式 card.

## Usage

Three surfaces on the phone, all writing the same `enabled` value:

| Where | What |
|---|---|
| Status strip above the composer | `Unrestricted · 4/4` / `Unrestricted · off` / anchor issue; tap opens the panel |
| Chat details → Plugins panel | switch, per-preset state, rule fingerprint, re-check |
| Plugin settings form | native switch with zh/en description |

`4/4` means all four presets passed their anchor check and were fused. A preset showing "anchor mismatch" falls back to the stock prompt; the others are unaffected.

Desktop keeps the original card: per-mode status, rule fingerprint, prompt preview (lines/bytes).

## Verification

Booted the real `@deepseek-ai/dsh@0.2.1-rc.4` with the same `dsh-base + dsh-web-app` composition the phone runs, twice (without / with the packaged plugin), and rendered every preset's system prompt:

| Preset | Stock | Fused | Plan mode (stock → fused) |
|---|---|---|---|
| standard | 4459 B | 15051 B | 6823 → 17764 B, plan note ✓ |
| ptc | 39288 B | 50282 B | 41652 → 52995 B ✓ |
| cordis | 4459 B | 15051 B | 6823 → 17764 B ✓ |
| minimal | 46 B | 10638 B | — (whole complete persona replaced) |

- rc.4's rendered `original-standard.md` is byte-identical to `tests/fixtures/original-standard.md` (same SHA-256): the four anchors have not drifted on this line.
- 57 unit tests pass (`rules` 32, `mobile` 20, `controller` 4, `manifest` 1).
- DSH Go `plugin-kit check`: `原生界面能显示（状态条 1 · 面板 1）`.
- Reproduce: `node tools/probe-rc4.mjs --root <dir with @deepseek-ai/dsh installed> [--link]`.

## Layout

```
src/node.js         engine half: fusion + toggle state (desktop and phone)
src/rules.js        anchors, rule text, pure fusion functions
src/mobile.js       phone half: strip / panel / actions
src/mobile-view.js  panel view and strip wording (pure, unit-tested)
lib/client.js       web half (React settings card)
docs/               design notes, phone install and troubleshooting
tests/              unit tests + captured 0.2.1-rc.4 prompt fixtures
tools/              packaging, probe, prompt dump
```

## Limits

- The plugin only rewrites the system prompt: file sandbox, approval prompts and plan-mode write protection stay in force, and upstream gateway filtering cannot be bypassed.
- Native surfaces exist only on the on-device engine; SSH and relay hosts fall back to the web plugin.

## License

[MIT](LICENSE). Upstream copyright belongs to [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted); the DSH Go plugin protocol and tooling belong to [ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go) (AGPL-3.0 — this repository only calls its interfaces and contains none of its code).
