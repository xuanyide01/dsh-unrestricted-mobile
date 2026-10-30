# dsh-unrestricted · DSH Go 适配版

DeepSeek Harness（DSH）的提示词破限插件，**在安卓客户端 DSH Go 上也能用**：桌面网页版保留原来的设置卡片，手机端额外提供原生状态条、原生面板和原生开关。

- 插件版本：`0.2.6-mobile.2`
- 适用引擎：DSH `>=0.2.1-rc.2 <0.2.3-0`（手机端实测 `0.2.1-rc.4`，桌面端实测 `0.2.1-rc.5`）
- 许可证：MIT

## 鸣谢

本项目是在下面两个仓库的成果上做的适配，规则文本、融合机制、插件协议都来自它们：

| 仓库 | 作用 |
|---|---|
| [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted) | 上游插件。破限规则、`system-prompt/assemble` 融合逻辑、锚点校验、网页设置卡片都出自这里；本仓库是它的手机端适配分支 |
| [ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go) | DSH Go 安卓客户端。提供本机引擎的运行时（DSH `0.2.1-rc.4` + `dsh-go-bridge`）、原生插件协议（`dshGo` 清单、状态条/面板/动作）、`plugin-kit` 校验工具与全部插件文档 |

另有 [Jia-Ethan/codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith)（MIT）提供了破限规则的结构与任务路由思路，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 这是什么

DSH 在每次请求前组装系统提示词。本插件挂在 `system-prompt/assemble` 瀑布上，把"无限制本地执行模式"这一节**融合进当前预设的原始提示词**，不替换、不改写工具定义：

- 角色设定后插入 `unrestricted:execution-mode` 分块；
- 计划模式、PTC（`run_code`）、结构化子代理三处只加边界注记，说明"约束的是交付形式，不是内容规模"；
- 关闭开关时原样放行，提示词与官方逐字节一致。

每个预设（standard / ptc / cordis / minimal）融合前都会核对官方锚点文本；任何一处对不上，该模式退回官方原文并在界面上标出，不会拼出损坏的提示词。

## 安装

### 安卓（DSH Go）

手机上的 `dsh plugin add` 是 link 安装，插件目录在 profile 之外。把压缩包放到手机「下载」后，在 **App 自带的终端**里：

```sh
rm -rf /root/.dsh/dsh-go/plugins/dsh-unrestricted
tar xzf /sdcard/Download/dsh-unrestricted-0.2.6-mobile.2.tgz -C /root/.dsh/dsh-go/plugins/
sh /root/.dsh/dsh-go/plugins/dsh-unrestricted/install-mobile.sh
```

脚本会依次：放目录 → `dsh plugin --profile web add <目录>` → 把 profile 的 `node_modules` 链进插件目录（解决 link 安装下的模块解析）→ 跑一次导入自检，打印 `OK 插件模块可以加载` 或具体报错。

装完「插件 → 重启内核以重载」，再到 `dsh-unrestricted → 配置` 打开「启用破限」。

> 已经装过 `.1` 版本的，可以只补一条链接再重启内核：
> `ln -s /root/.dsh/profiles/web/node_modules /root/.dsh/dsh-go/plugins/dsh-unrestricted/node_modules`

### 桌面 / 网页版

```sh
dsh plugin --profile web add github:xuanyide01/dsh-unrestricted-mobile
# 或按目录安装
dsh plugin --profile web add /path/to/dsh-unrestricted
```

装完重启 `dsh web`，在「插件 → dsh-unrestricted → 破限模式」卡片里打开开关。

## 使用

手机上三个入口，写的是同一个 `enabled`：

| 位置 | 内容 |
|---|---|
| 输入框上方状态条 | `破限 开 · 4/4` / `破限 关` / `破限 锚点异常`（点开进面板） |
| 对话详情 →「插件」面板 | 开关、四模式注入状态、规则指纹、重新检测 |
| 插件详情页配置表单 | 「启用破限」原生开关，中英文说明 |

`4/4` 表示 standard / ptc / cordis / minimal 四个预设的锚点全部匹配、注入成功；只要有一个显示「锚点未匹配」，那个模式就会退回官方提示词，其余不受影响。

桌面网页版仍是原来的设置卡片：模式状态、规则指纹、提示词预览（行数/字节数）。

## 验证

在真实 `@deepseek-ai/dsh@0.2.1-rc.4` 上按手机的 `dsh-base + dsh-web-app` 组合启动两次（不带插件 / 带打包产物），逐预设渲染系统提示词：

| 预设 | 原版 | 融合后 | 计划模式（原 → 融合） |
|---|---|---|---|
| standard | 4459 B | 15051 B | 6823 → 17764 B，计划注记 ✓ |
| ptc | 39288 B | 50282 B | 41652 → 52995 B ✓ |
| cordis | 4459 B | 15051 B | 6823 → 17764 B ✓ |
| minimal | 46 B | 10638 B | —（complete 段整体替换） |

- rc.4 渲染出的 `original-standard.md` 与本仓库 `tests/fixtures/original-standard.md` 逐字节一致（SHA-256 相同），说明四个锚点在这条版本线上没有漂移。
- 单测 57 条全绿：`rules` 32、`mobile` 20、`controller` 4、`manifest` 1。
- DSH Go 的 `plugin-kit check`：`原生界面能显示（状态条 1 · 面板 1）`。
- 复现方式：`node tools/probe-rc4.mjs --root <装了 @deepseek-ai/dsh 的目录> [--link]`。

## 目录

```
src/node.js         引擎半侧：融合逻辑 + 开关状态（桌面/手机共用）
src/rules.js        锚点、规则文本、纯融合函数
src/mobile.js       手机半侧：注册状态条 / 面板 / 动作
src/mobile-view.js  面板视图与状态条文案（纯函数，可单测）
lib/client.js       网页半侧（React 设置卡片）
docs/               设计说明、手机安装与排错
tests/              单测（含 0.2.1-rc.4 的提示词夹具）
tools/              打包、探针、提示词 dump
```

开发：

```sh
npm install --ignore-scripts   # 仅客户端构建与类型检查需要
node --test tests/*.spec.mjs
node tools/build-mobile.mjs --out dist
```

## 常见问题

**手机插件页显示「尚未就绪 · 0/1 个组件运行中」？**
link 安装下插件目录在 profile 之外，Node 按真实路径解析不到 `@deepseek-ai/*`。先跑诊断：

```sh
sh /root/.dsh/dsh-go/plugins/dsh-unrestricted/doctor-mobile.sh
```

「导入自检」若报 `ERR_MODULE_NOT_FOUND`，补一条链接即可（安装脚本已自动处理）：

```sh
ln -s /root/.dsh/profiles/web/node_modules /root/.dsh/dsh-go/plugins/dsh-unrestricted/node_modules
```

**状态条/面板不出现？** 只有本机引擎带 `dsh-go-bridge`；SSH、中转主机没有，用插件详情页的开关或网页版卡片。

**「锚点未匹配」？** 官方提示词文本变了，按 `tools/probe-rc4.mjs` 的流程复现并更新 `src/rules.js` 的 `ANCHORS`。

## 限制

- 破限只改系统提示词：文件沙箱、命令审批、计划模式写保护都不变，上游网关的关键词拦截也绕不过。
- 手机端的原生界面只在本机引擎上有；远程主机退回网页版插件。

## 许可证

[MIT](LICENSE)。上游版权归 [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted)；DSH Go 的插件协议与工具链归 [ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go)（AGPL-3.0，本仓库只调用其接口，不包含其代码）。
