#!/bin/sh
# 发布一个新的 GitHub Release（复刻 v0.2.6-mobile.2 的做法）。
#
# 用法：
#   GITHUB_TOKEN=ghp_xxx sh tools/release.sh                 # 打包 + tag + push + 建 Release
#   GITHUB_TOKEN=ghp_xxx sh tools/release.sh --no-push       # 只打包资产，不碰远端
#   GITHUB_TOKEN=ghp_xxx sh tools/release.sh --draft         # Release 先存草稿
#
# token 需要 repo 权限（classic）或 contents:write（fine-grained）。
# 仓库 / 分支默认取 package.json 的 githubRepo / gitBranch，可用环境变量覆盖：
#   REPO=xuanyide01/dsh-unrestricted-mobile BRANCH=main
set -eu

VERSION=$(node -p "require('./package.json').version")
REPO="${REPO:-$(node -p "require('./package.json').githubRepo || 'xuanyide01/dsh-unrestricted-mobile'")}"
BRANCH="${BRANCH:-$(node -p "require('./package.json').gitBranch || 'main'")}"
TAG="v${VERSION}"
DIST=dist

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "找不到 node"
[ -z "$(git status --porcelain)" ] || die "工作区有未提交改动，先 commit（发布内容要和 tag 一致）"

say "== 1/4 打包 $VERSION"
node tools/build-mobile.mjs --out "$DIST"

say "== 2/4 生成与上游的移植补丁"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# UPSTREAM_DIR 可指向一份已克隆的上游（避免每次发布都联网克隆）；默认现场克隆。
if [ -n "${UPSTREAM_DIR:-}" ] && [ -d "$UPSTREAM_DIR" ]; then
  cp -a "$UPSTREAM_DIR" "$TMP/a"
  rm -rf "$TMP/a/.git"
else
  git clone --depth 1 -q https://github.com/yexi-by/dsh-unrestricted.git "$TMP/a" || die "克隆上游失败"
  rm -rf "$TMP/a/.git"
fi
mkdir -p "$TMP/b"
tar -C . --exclude=.git --exclude=dist --exclude=node_modules -cf - . | tar -C "$TMP/b" -xf -
( cd "$TMP" && git diff --no-index --no-color --binary --src-prefix= --dst-prefix= a b > "$OLDPWD/$DIST/dsh-unrestricted-$VERSION.patch" ) || true
[ -s "$DIST/dsh-unrestricted-$VERSION.patch" ] || die "补丁生成失败"

say "== 3/4 校验和"
node -e '
const fs=require("fs"),c=require("crypto");
const v=require("./package.json").version;
const files=[`dsh-unrestricted-${v}.patch`,`dsh-unrestricted-${v}.tgz`];
fs.writeFileSync("dist/SHA256SUMS.txt", files.map(f=>c.createHash("sha256").update(fs.readFileSync("dist/"+f)).digest("hex")+"  "+f).join("\n")+"\n");
' || die "校验和失败"
cat "$DIST/SHA256SUMS.txt"

if [ "${1:-}" = "--no-push" ]; then
  say "== 4/4 跳过推送（--no-push）；资产在 $DIST/"
  exit 0
fi

say "== 4/4 推送并创建 Release $TAG"
git -c user.name="dsh" -c user.email="dsh@local" tag -a "$TAG" -m "$TAG" 2>/dev/null || say "tag $TAG 已存在，复用"
# 有 token 就直接用它推（不用先配 git 凭据）；没有就走本地 git 凭据。
REMOTE="https://github.com/$REPO.git"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/$REPO.git"
fi
git push "$REMOTE" "HEAD:$BRANCH"
git push "$REMOTE" "$TAG"
GITHUB_TOKEN="${GITHUB_TOKEN:-}" node tools/upload-release.mjs --dist "$DIST" --repo "$REPO" --tag "$TAG" ${1:+$1}
