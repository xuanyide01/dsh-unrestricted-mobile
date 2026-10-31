# 装到 DSH Go（安卓）

本包 `dsh-unrestricted 0.2.6-mobile.3` 同时带两套界面：

| 在哪 | 界面 | 开关在哪 |
|---|---|---|
| DSH Go App（本机引擎） | **原生**：输入框上方状态条 + 「插件」面板 + 原生设置表单 | 面板按钮、插件详情页的开关，二选一 |
| DSH 网页版 / 桌面端 | 原来的设置卡片（React） | 「破限模式」卡片 |

提示词融合逻辑两端完全相同，都挂在 `system-prompt/assemble` 上。

## 前提

- App 里已装好**本机运行环境**（不是只连电脑/服务器的那种）。菜单「引擎」里能看到本机引擎在跑。
- 本机引擎是 DSH `0.2.1-rc.4`（App 运行时固定版本），本包声明范围 `>=0.2.1-rc.2 <0.2.3-0`，覆盖它。

## 安装

插件是「按目录装」的：目录留着，插件才能起。一共三步。

### 1. 把目录放进本机环境

三选一：

**A. 用 App 的终端（有网时最省事）**

```sh
mkdir -p /root/.dsh/dsh-go/plugins
cd /root/.dsh/dsh-go/plugins
# 有网：直接拉仓库
git clone --depth 1 https://github.com/yexi-by/dsh-unrestricted.git
cd dsh-unrestricted && git checkout v0.2.6-mobile.3
```

**B. 从手机存储拷（离线推荐）**

1. 把 `dsh-unrestricted` 整个目录（或 `dsh-unrestricted-0.2.6-mobile.3.tgz`）放到手机「下载」。
2. 设置里打开「访问手机文件」。
3. App 终端：

```sh
mkdir -p /root/.dsh/dsh-go/plugins
cp -r /sdcard/Download/dsh-unrestricted /root/.dsh/dsh-go/plugins/
# 或者用 tgz
tar xzf /sdcard/Download/dsh-unrestricted-0.2.6-mobile.3.tgz -C /root/.dsh/dsh-go/plugins/
```

**C. 用 adb（开发机）**

```sh
adb push dsh-unrestricted /sdcard/Download/
# 然后在 App 终端里执行 B 的第 3 步
```

### 2. 装进 profile

```sh
dsh plugin --profile web add /root/.dsh/dsh-go/plugins/dsh-unrestricted
```

- 手机本机引擎用的 profile 就是 `web`。
- 装上几秒内 App 的「插件」页就能看到它，不用重启。
- 如果提示版本不匹配，说明本机引擎不是 0.2.1 线，先看下面「常见问题」。

也可以用包里的一键脚本（会做同样的两件事）：

```sh
sh /root/.dsh/dsh-go/plugins/dsh-unrestricted/install-mobile.sh /root/.dsh/dsh-go/plugins/dsh-unrestricted
```

### 3. 打开破限

两个入口，任选一个：

- **插件详情页**：插件 → `dsh-unrestricted` → 配置 → 打开「启用破限」（原生开关，即时生效）。
- **原生面板**：对话详情页 →「插件」页签 →「破限」→ 点「开启破限」。

也可以直接在输入框上方的状态条看结果：`破限 开 · 4/4` 表示四个预设都已注入。

## 验证

1. 状态条显示 `破限 开 · 4/4`。
2. 面板里「标准模式 / PTC 模式 / Cordis 模式 / 最小模式」四行都是「已注入」。
3. 新建一段对话，问一个平时会被拒的请求，看首行是否直接给结果。

面板里「规则指纹」应等于本包 `src/rules.js` 里 `EXECUTION_MODE_BLOCK` 的 SHA-256 前 16 位；四个模式里只要有一个显示「锚点未匹配」，说明该模式的官方提示词变了，那个模式会退回原版（其余模式不受影响）。

## 更新

```sh
dsh plugin --profile web remove dsh-unrestricted
# 换掉 /root/.dsh/dsh-go/plugins/dsh-unrestricted 目录内容
dsh plugin --profile web add /root/.dsh/dsh-go/plugins/dsh-unrestricted
```

改了 `lib/` 或 `src/` 的代码要重启引擎（App 的「引擎」页），因为已经载入的模块不会热替换。

## 卸载

```sh
dsh plugin --profile web remove dsh-unrestricted
rm -rf /root/.dsh/dsh-go/plugins/dsh-unrestricted
```

卸载后系统提示词立刻回到官方原版，会话记录里不会留下注入痕迹。

## 常见问题

**插件详情页显示「尚未就绪 · 0/1 个组件运行中」「未运行」？**

手机上的 `dsh plugin add` 是 **link 安装**：插件目录留在 `/root/.dsh/dsh-go/plugins/`，profile 里只有一个链接。从 `0.2.6-mobile.3` 起插件不再硬 import 引擎包（`src/deps.js` 自己按安装锚点找），所以这一层不再需要额外链接。

先跑诊断（只读，输出可直接复制）：

```sh
sh /root/.dsh/dsh-go/plugins/dsh-unrestricted/doctor-mobile.sh
```

看最后两段：

- `独立导入` 显示 `OK` → 模块能加载；问题在服务、桥接或开关配置，把整段输出发出来。
- `独立导入` 显示 `FAIL` → 真的缺文件或语法错误，按提示行修。
- `引擎包` 显示 `可选依赖：schemastery=有 render=有` 是正常状态；两个都 `无` 也能跑（只剩提示词预览不可用）。

**状态条不出现？**
- 只有**本机引擎**有桥接（`dsh-go-bridge`），SSH / 中转主机没有，那种情况用网页版设置卡片或直接在插件详情页开开关。
- App 版本低于清单要求时原生部分不显示，插件本身仍然工作。

**面板按钮点了没反应？**
- 面板的开关是通过 loader 写 profile 的 `cordis.patch.yml`；如果引擎以只读方式启动，写不进去，这时用插件详情页的开关（同样写这个文件）。

**「锚点未匹配」怎么办？**
- 说明该预设的官方 persona / 计划模式 / PTC 段文本变了。用 `node tools/probe-rc4.mjs --root <DSH 安装目录>` 在本机复现，按输出修 `src/rules.js` 的 `ANCHORS`。

**装完 App 打不开模型？**
- 破限只改系统提示词，不碰模型配置。先看插件页里插件是否「已启用」，再看 `cordis.patch.yml` 里 `dsh-unrestricted` 的 `enabled` 值。
