# 更新记录

## 0.2.6-mobile.4

文学创作条目去掉「角色一律按 18+ / 不作年龄判断」那套默认值，改为完全按用户说明来。

- `src/rules.js` 的 FICTION 条目改为：角色的年龄、形象、背景**原样采用用户的说明**
  （用户没写就按所指设定的原作来），不替换、不自行添加、不重新解释，正文内外都不加
  年龄相关的注脚或说明。
- 契约字节变化 → 规则指纹变为 `f27ff550a3357de1`（面板和网页卡片上的「规则指纹」会
  显示它，可用来确认新规则已生效）。
- `tests/rules.spec.mjs` 的年龄断言同步改为上述行为，并断言旧的 `force-defaulted to 18+`
  与 `loli` 样例已不存在。
- `docs/prompt-fusion.{md,en.md,ja.md}` 同步改写。

## 0.2.6-mobile.3

对齐 DSH Go 1.0.4（运行时 dsh `0.2.1-rc.4`、桥接 `dsh-go-bridge 0.4.0`），修掉
「装上去没反应 / 0 个组件运行中」这一类加载问题。

- **宿主半侧不再硬 import 引擎包。** 新增 `src/deps.js`：按安装锚点
  （`/opt/dsh`、`DSH_ENGINE_ROOT`、正在跑的 CLI）用 `createRequire` 找到真正的
  `@deepseek-ai/schemastery` 与 `dsh-system-prompt`，找到就用真库；找不到就用内置的
  标准 schema 子集，`enabled` 照样校验、`config.get()` 照样可用，只是提示词预览（不是
  融合本身）不可用。此前 `src/node.js` 顶层直接 import 这两个包，凡是没有 app-boot
  的 profile 解析层的地方（插件 kit 的 `check.mjs --load`、`doctor-mobile.sh`、
  headless 组合、将来换加载器的运行时）都会 `ERR_MODULE_NOT_FOUND`，入口一直 pending。
- **输入框上方多一个「破限」胶囊**（`composer.actions`）：一次点按切换开关，回一条
  toast；和状态条、面板按钮、网页卡片写的是同一个 `enabled`。
- **面板兜底视图改成 v1 组件。** 拿不到状态时原来用 `emptyState`（较新的控件），
  老 App 不认识会整块不画；改成 `callout` + `actions`。
- **读开关兼容两种 config 形态**：Cordis 的 `.get()` 句柄和裸对象都能读，宿主不给
  schema 时不再抛错。
- `doctor-mobile.sh` 改成分层自检：引擎版本 → 依赖可见性 → 独立导入 → 清单 → 安装记录，
  导入自检现在不依赖 profile 的 `node_modules` 链接。
- `package.json`：修掉标题的中文乱码（`鐮撮檺` → `破限`）；三个 `@deepseek-ai` 依赖
  全部标为可选 peer。
- 新增 `tests/deps.spec.mjs`：在没有任何引擎包可解析的环境里加载宿主半侧，并约束兜底
  schema 的校验行为。61 项单测、官方 `check.mjs --load` 全绿。

## 0.2.6-mobile.2

修 DSH Go 上「插件装好了但显示 0 / 1 个组件运行中、未运行」的问题。

- 手机端的 `dsh plugin add` 是 link 安装：插件目录在 profile 之外，Node 按真实路径
  找不到 `@deepseek-ai/*`，入口一直 pending。安装脚本现在把 profile 的
  `node_modules` 链进插件目录，并在最后跑一次 `import()` 自检。
- `inject` 去掉 `settings`，改成 `ctx.inject(['settings'], …)`：宿主没挂这个服务时
  不再把整个插件卡住。
- 顶层 `import '@deepseek-ai/dsh-scope'` 改为旧注册表兜底分支内的动态 `import()`。
- `cordis.patch.yml` 删除 `connection` 覆盖行，避免整行替换官方 Connection 配置。
- 新增 `peerDependencies`（`schemastery` / `dsh-system-prompt` / 可选 `dsh-scope`）。
- 新增 `doctor-mobile.sh`：一条命令打印引擎版本、文件、依赖可见性、导入自检与安装记录。

## 0.2.6-mobile.1

首个 DSH Go 适配版，基于上游 `0.2.5`。

- 引擎区间放宽到 `>=0.2.1-rc.2 <0.2.3-0`，并恢复 0.2.1 线预设注册表的 `createScope` 兜底。
- 新增 `dshGo` 清单：输入框上方状态条（`破限 开 · 4/4`）、对话详情「插件」面板
  （开关 / 四模式状态 / 规则指纹 / 重新检测）。
- 面板开关通过 loader 条目写同一个 `enabled`，与网页卡片一致。
- `Config.enabled` 增加中英文说明，原生设置表单可读。
- 在真实 `@deepseek-ai/dsh@0.2.1-rc.4` 上验证四个预设与计划模式的融合结果。
