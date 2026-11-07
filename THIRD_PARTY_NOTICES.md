# 第三方版权声明

本仓库是 [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted) 的
DSH Go（安卓）适配分支，并依赖 [ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go)
定义的原生插件协议。下面逐项列出出处与许可。

## dsh-unrestricted（上游插件）

`src/rules.js`、`src/node.js`、`src/client/`、`lib/client.js`、`docs/` 与
`tests/` 中的规则文本、融合逻辑、锚点与网页设置卡片改编自
[yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted)
（`0.2.8`，MIT License）。本分支在此基础上增加了 DSH Go 的原生状态条、面板、
开关、安装脚本与 `0.2.1` 线兼容处理。

```text
MIT License

Copyright (c) 2026 yexi-by

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## dsh-go（DSH Go 安卓客户端）

本仓库**不包含** dsh-go 的代码，只对接它公开的原生插件协议：

- `package.json` 的 `dshGo` 清单（`v` / `title` / `icon` / `contributes`）；
- 宿主半侧的 `ctx.inject(['dshGo'])`、`dshGo.panel()`、`dshGo.strip()`；
- 视图 JSON 的组件约定（`stack` / `row` / `metric` / `keyValue` / `list` /
  `actions` / `callout` / `emptyState`）与效果白名单（`toast` / `refresh`）；
- `sdk/plugin-kit` 的 `check` 工具用于本地校验清单。

DSH Go 以 **AGPL-3.0** 发布（`sdk/`、`examples/` 为 MIT）。插件的协议文档与
校验工具见 [ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go)。
本仓库的 MIT 许可不改变上游仓库各自的许可。

## codex-keysmith

`src/rules.js` 中的破限提示词以
[Jia-Ethan/codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith) 的
[`examples/gpt-unrestricted.md`](https://github.com/Jia-Ethan/codex-keysmith/blob/601a449b05a86576cf0ad93d7b9fffb89da302ca/examples/gpt-unrestricted.md)
为参考并进行了修改。

原项目使用以下许可证：

```text
MIT License

Copyright (c) 2026 Jia-Ethan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DeepSeek Harness

`src/rules.js` 中的当前提示词锚点和 `tests/fixtures/` 中的原版提示词来自
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84)
`0.2.0-rc.2`。

原项目使用以下许可证：

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
