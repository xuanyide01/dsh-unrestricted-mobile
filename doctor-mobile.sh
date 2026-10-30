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

line "引擎版本"
ENGINE="$PROFILE_DIR/node_modules/@deepseek-ai/dsh/package.json"
if [ -f "$ENGINE" ]; then
  node -e "console.log(require('$ENGINE').version)" 2>/dev/null || echo 读取失败
else
  echo "找不到 $ENGINE"
fi

line "插件文件"
for f in package.json src/node.js src/rules.js src/mobile.js lib/client.js cordis.patch.yml; do
  [ -f "$PLUGIN/$f" ] && echo "  ok   $f" || echo "  缺失 $f"
done
[ -L "$PLUGIN/node_modules" ] && echo "  node_modules -> $(readlink "$PLUGIN/node_modules" 2>/dev/null)" || true

line "宿主依赖是否可见（按插件的真实路径解析）"
for p in schemastery dsh-system-prompt dsh-scope; do
  if [ -d "$PROFILE_DIR/node_modules/@deepseek-ai/$p" ]; then echo "  profile 有 $p"; else echo "  profile 无 $p"; fi
done

line "导入自检（引擎加载插件的同一套解析）"
node --input-type=module -e "
try {
  const m = await import('file://$PLUGIN/src/node.js')
  console.log('OK', Object.keys(m).join(','))
} catch (error) {
  console.log('FAIL', error?.code ?? '', error?.message ?? error)
}" 2>&1

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
