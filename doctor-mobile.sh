#!/bin/sh
# dsh-unrestricted · 手机端诊断
#
# 在 App 自带的终端里运行：
#   sh /root/.dsh/dsh-go/plugins/dsh-unrestricted/doctor-mobile.sh
#
# 输出可以直接整段复制发出去。它只读，不改任何东西。
set -u

PROFILE="${DSH_PROFILE:-web}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PLUGIN="${1:-/root/.dsh/dsh-go/plugins/dsh-unrestricted}"

line() { printf '\n== %s ==\n' "$1"; }

line "环境"
printf 'node      : %s\n' "$(node -v 2>/dev/null || echo 缺失)"
printf 'dsh       : %s\n' "$(dsh --version 2>/dev/null || echo '未知')"
printf 'DSH_HOME  : %s\n' "$DSH_HOME"
printf 'profile   : %s\n' "$PROFILE_DIR"
printf '插件目录  : %s\n' "$PLUGIN"
printf 'App 运行时: %s\n' "$(sed -n 's/.*"runtimeVersion": *"\([^"]*\)".*/\1/p' /etc/dsh-app/runtime.json 2>/dev/null || echo '没有 /etc/dsh-app/runtime.json（不是本机引擎）')"
printf '桥接版本  : %s\n' "$(sed -n 's/.*"dshGoBridge": *"\([^"]*\)".*/\1/p' /etc/dsh-app/runtime.json 2>/dev/null || echo '未知')"

line "插件文件"
for f in package.json src/node.js src/deps.js src/rules.js src/mobile.js src/mobile-view.js lib/client.js cordis.patch.yml; do
  [ -f "$PLUGIN/$f" ] && echo "  ok   $f" || echo "  缺失 $f"
done
if [ -L "$PLUGIN/node_modules" ]; then
  echo "  node_modules -> $(readlink "$PLUGIN/node_modules" 2>/dev/null)（0.2.6-mobile.3 起不需要，留着无害）"
fi
printf '  版本      : %s\n' "$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$PLUGIN/package.json" 2>/dev/null | head -n 1)"

line "引擎包（可选依赖：找到就用真库，找不到用内置兜底）"
node --input-type=module -e "
const m = await import('file://$PLUGIN/src/deps.js')
console.log('  schemastery       :', m.engineDeps.schema ? '有' : '无（用兜底 schema）')
console.log('  dsh-system-prompt :', m.engineDeps.render ? '有' : '无（只有提示词预览不可用）')
if (m.engineDeps.schemaFile) console.log('  解析到            :', m.engineDeps.schemaFile)
" 2>&1

line "独立导入（不依赖 profile 的 node_modules 链接）"
node --input-type=module -e "
try {
  const m = await import('file://$PLUGIN/src/node.js')
  console.log('OK', Object.keys(m).join(','))
  const cfg = m.Config['~standard'].validate({ enabled: true })
  console.log('config 校验:', JSON.stringify(cfg.value.get()))
} catch (error) {
  console.log('FAIL', error?.code ?? '', error?.message ?? error)
}" 2>&1

line "清单（App 读的那一份）"
node -e "
const p = require('$PLUGIN/package.json')
const go = p.dshGo ?? {}
const c = go.contributes ?? {}
const ids = [].concat(c['composer.actions'] ?? [], c['composer.strip'] ?? [], c.panels ?? []).map(x => x.id)
console.log('  dshGo.v   :', go.v)
console.log('  title     :', go.title?.zh, '/', go.title?.en)
console.log('  插槽      : 胶囊', (c['composer.actions'] ?? []).length, '· 状态条', (c['composer.strip'] ?? []).length, '· 面板', (c.panels ?? []).length)
console.log('  id        :', ids.join(', '))
console.log('  id 唯一   :', new Set(ids).size === ids.length ? '是' : '否（App 会丢掉重复项）')
" 2>&1

line "profile 里的安装记录"
grep -n 'dsh-unrestricted' "$PROFILE_DIR/package.json" 2>/dev/null || echo "  package.json 里没有 dsh-unrestricted"
grep -n 'unrestricted' "$PROFILE_DIR/cordis.patch.yml" 2>/dev/null || echo "  cordis.patch.yml 里没有 unrestricted 条目"

line "入口配置"
sed -n '/unrestricted/,+6p' "$PROFILE_DIR/cordis.patch.yml" 2>/dev/null | head -n 12

line "引擎日志尾部（App 的「引擎日志」页内容更全）"
for f in "$DSH_HOME/logs/engine.log" "$DSH_HOME/logs/dsh.log" "$DSH_HOME/engine.log"; do
  [ -f "$f" ] && { echo "--- $f"; tail -n 40 "$f"; }
done
echo "（没有找到日志文件时，用 App 的「引擎日志」按钮看）"
