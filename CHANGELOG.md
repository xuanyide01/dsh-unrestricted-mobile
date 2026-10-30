# 更新记录

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
