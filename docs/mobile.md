# 手机端（DSH Go）适配说明

DSH Go 是 DeepSeek Harness 的安卓客户端：它把**真正的 DSH 引擎**跑在 App 自带的 Linux 环境里（PRoot，免 Root），profile 名一样是 `web`。所以破限插件在手机上不需要重写融合逻辑——那部分是引擎里的 Node 代码，和桌面端完全相同。

手机端真正不同的只有三件事，这个分支就是针对它们做的：

1. **引擎版本**：App 的运行时固定 DSH `0.2.1-rc.4`，桌面端是 `0.2.1-rc.5`。上游 0.2.5 把引擎下限抬到了 `0.2.2-alpha.2`，在手机上会被 `dsh plugin add` 直接拒装；同时 0.2.5 删掉了老预设注册表（没有 `acquireScope`）的兜底路径。这里两条都恢复：声明 `>=0.2.1-rc.2 <0.2.3-0`，并在 `presetAssembly()` 里保留 `createScope` 兜底。
2. **界面**：手机原生界面不跑 React，网页设置卡片在原生模式下根本不会加载。改成用 dsh-go 的原生通道：
   - 输入框上方**状态条**（`composer.strip`）：`破限 开 · 4/4` / `破限 关` / `破限 锚点异常`。
   - **原生面板**（`panels`）：破限开关、四模式注入状态、规则指纹、重新检测。
   - 面板里的开关直接写 loader 条目，和网页卡片写的是同一个 `enabled`。
3. **配置表单**：`Config.enabled` 加了中英文 `description`，插件详情页的原生表单能读懂这是干什么的。

网页端完全不受影响：`dshGo` 清单和 `ctx.dshGo` 只对 App 生效，桌面网页版看不到它们，仍然用原来的设置卡片。

## 结构

```
dsh-unrestricted
├─ src/node.js         引擎半侧：system-prompt/assemble 融合 + 开关状态（桌面/手机共用）
├─ src/rules.js        锚点、规则文本、纯融合函数
├─ src/mobile.js       手机半侧：注册状态条/面板/动作（只在有 dsh-go 桥接的主机上跑）
├─ src/mobile-view.js  面板视图、状态条文字、提示语（纯函数，可单测）
├─ lib/client.js       网页半侧（React 卡片，未改动）
└─ package.json        新增 "dshGo" 清单（v1）
```

### 开关的写入路径

```
面板按钮 ──invoke──▶ mobile.js handler
                        │ controller.setEnabled(next)
                        ▼
              loader entry.update({ config: { enabled } })
                        │ 只有 volatile 字段变化 → 不重挂载
                        ▼
              loader/volatile-update
                        │
                        ▼
        node.js 切换 state.enabled → 下一次 assemble 生效
```

网页卡片走的是 settings namespace → 同一个 config；两条路径落到同一处，所以两端状态始终一致。

### 原生面板的降级

| 情形 | 行为 |
|---|---|
| 主机没有 `dshGo` 服务（桌面/headless/SSH） | `ctx.inject(['dshGo'])` 的回调不执行，什么都不注册 |
| App 版本低于清单要求、或插槽写错 | App 只丢掉那一项，插件照常工作 |
| 面板动作 3 秒内没回效果 | App 自己超时，插件侧把异常吞掉，不累计违规 |
| 拿不到本插件对应的 loader 条目 | 面板开关返回「开关未生效，请到插件详情页设置」，不抛错 |

## 在 0.2.1-rc.4 上实测

`tools/probe-rc4.mjs` 会装一份真实的 `@deepseek-ai/dsh@0.2.1-rc.4`，按手机的 `web` profile 组合（`dsh-base` + `dsh-web-app`）启动两次：一次不带插件、一次带插件，逐预设渲染真实系统提示词。实测结果（字节）：

| 预设 | 原版 | 融合后 | 插入段 | 计划模式 |
|---|---|---|---|---|
| standard | 4459 | 15051 | `unrestricted:execution-mode` | 6823 → 17764，计划注记 ✓ |
| ptc | 39288 | 50282 | 同上 + PTC 运输注记 | 41652 → 52995 ✓ |
| cordis | 4459 | 15051 | 同 standard | 6823 → 17764 ✓ |
| minimal | 46 | 10638 | 合并进 persona（complete 段） | — |

其中 rc.4 的 `original-standard.md` 与本仓库 `tests/fixtures/original-standard.md` **逐字节一致**，说明 `ANCHORS` 里四个锚点在这条版本线上没有漂移。

复现：

```sh
npm install --ignore-scripts @deepseek-ai/dsh@0.2.1-rc.4   # 任意目录，装进 <root>
node tools/probe-rc4.mjs --root <root> --out <输出目录>
```

## 限制

- 状态条/面板只在**本机引擎**出现。SSH 或中转主机没有 `dsh-go-bridge`，那种场景用网页版卡片或插件详情页的开关。
- 手机端 WebView 里的网页版仍然是网页版，卡片照常显示，两个开关写同一处，不会打架。
- 破限只改系统提示词：文件沙箱、命令审批、计划模式的写保护都不变；上游网关的关键词拦截也绕不过。
