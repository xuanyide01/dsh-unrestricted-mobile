#!/bin/sh
# dsh-unrestricted · 手机端（DSH Go）一键安装 + 自检
#
# 在 App 自带的终端（本机引擎的 shell）里运行：
#   sh install-mobile.sh                 # 安装脚本所在目录
#   sh install-mobile.sh /sdcard/Download/dsh-unrestricted
#   sh install-mobile.sh /sdcard/Download/dsh-unrestricted-0.2.6-mobile.3.tgz
#
# 做的事：把插件放到 /root/.dsh/dsh-go/plugins/，装进 web profile，
# 最后做一次导入自检并打印结果。
set -eu

PROFILE="${DSH_PROFILE:-web}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DEST_DEFAULT=/root/.dsh/dsh-go/plugins/dsh-unrestricted
HERE=$(cd "$(dirname "$0")" && pwd)
SRC="${1:-$HERE}"
DEST="${2:-$DEST_DEFAULT}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v dsh >/dev/null 2>&1 || die "找不到 dsh：这台终端不是 App 的本机引擎（或用的是 adb shell）。请用 App 里的「终端」。"
command -v node >/dev/null 2>&1 || die "找不到 node：本机引擎的运行时还没装好。"

if [ -f "$SRC" ]; then
  case "$SRC" in
    *.tgz|*.tar.gz)
      mkdir -p "$(dirname "$DEST")"
      say "解包 $(basename "$SRC") → $(dirname "$DEST")"
      tar xzf "$SRC" -C "$(dirname "$DEST")"
      ;;
    *) die "只支持目录或 .tgz：$SRC" ;;
  esac
elif [ -d "$SRC" ]; then
  if [ "$(cd "$SRC" && pwd)" != "$(cd "$(dirname "$DEST")" 2>/dev/null && pwd)/$(basename "$DEST")" ]; then
    mkdir -p "$DEST"
    say "复制 $SRC → $DEST"
    cp -a "$SRC"/. "$DEST"/
  fi
else
  die "路径不存在：$SRC"
fi

[ -f "$DEST/package.json" ] || die "$DEST 里没有 package.json"

# 1) 装进 profile（link 安装：目录留着，插件才能起）。
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DEST/package.json" | head -n 1)
say "安装 dsh-unrestricted ${VERSION:-?} 到 profile“$PROFILE”"

dsh plugin --profile "$PROFILE" remove dsh-unrestricted >/dev/null 2>&1 || true
dsh plugin --profile "$PROFILE" add "$DEST"

# 2) 0.2.6-mobile.2 留下的 node_modules 链接已经不需要（src/deps.js 自己找引擎包）；
#    留着也无害，这里只在旧链接指向不存在目录时清掉。
if [ -L "$DEST/node_modules" ] && [ ! -d "$DEST/node_modules" ]; then
  rm -f "$DEST/node_modules"
  say "清掉失效的 node_modules 链接"
fi

# 3) 导入自检：不依赖 profile 的 node_modules，和引擎无关的纯 Node 也能加载。
say "--- 导入自检 ---"
if node --input-type=module -e "
try {
  await import('file://$DEST/src/node.js')
  console.log('OK 插件模块可以加载')
} catch (error) {
  console.log('FAIL', error?.code ?? '', error?.message ?? error)
  process.exit(1)
}"; then
  :
else
  say ""
  say "插件模块加载失败——把上面这行错误发给维护者，或跑 doctor-mobile.sh 出完整报告。"
fi

cat <<EOF

已安装。接下来：
  1. App →「插件」→ dsh-unrestricted → 配置 → 打开「启用破限」
     或者：输入框上方的「破限」胶囊点一下
     或者：对话详情页 →「插件」→「破限」→「开启破限」
  2. 输入框上方状态条显示「破限 开 · 4/4」即四模式都已注入
  3. 改过 lib/ 或 src/ 后要在「插件 → 重启内核以重载」里重启才能生效

卸载：
  dsh plugin --profile $PROFILE remove dsh-unrestricted
  rm -rf $DEST
EOF
