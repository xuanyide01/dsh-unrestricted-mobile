#!/usr/bin/env node
/**
 * Create a GitHub Release for this package and upload the release assets.
 *
 * Reproduces the layout of v0.2.6-mobile.2:
 *   dsh-unrestricted-<version>.tgz       install bundle
 *   dsh-unrestricted-<version>.patch     diff from the upstream plugin
 *   INSTALL-mobile.md                    install sheet
 *   PORT-NOTES.md                        what the port changed
 *   VALIDATION.json                      machine-readable verification
 *   SHA256SUMS.txt                       digests of .patch and .tgz
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_… node tools/upload-release.mjs [--dist dist] [--repo owner/name] [--draft]
 *
 * `--dist` is the directory tools/build-mobile.mjs wrote (default: ./dist).
 * The token needs `repo` scope (classic) or contents:write (fine-grained).
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const API = 'https://api.github.com'
const UPLOAD_API = 'https://uploads.github.com'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
if (token === undefined || token === '') {
  console.error('缺少 GITHUB_TOKEN（或 GH_TOKEN）。用有 repo 权限的 token 运行：')
  console.error('  GITHUB_TOKEN=ghp_xxx node tools/upload-release.mjs')
  process.exit(2)
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const version = pkg.version
const tag = arg('tag', `v${version}`)
const dist = resolve(arg('dist', new URL('../dist', import.meta.url).pathname))
const repo = arg('repo', pkg.githubRepo ?? 'xuanyide01/dsh-unrestricted-mobile')
const draft = process.argv.includes('--draft')

const ASSETS = [
  `dsh-unrestricted-${version}.tgz`,
  `dsh-unrestricted-${version}.patch`,
  'INSTALL-mobile.md',
  'PORT-NOTES.md',
  'VALIDATION.json',
  'SHA256SUMS.txt',
].filter(name => {
  if (existsSync(join(dist, name))) return true
  console.warn(`skip missing asset: ${name}`)
  return false
})

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'dsh-unrestricted-mobile-release',
  'X-GitHub-Api-Version': '2022-11-28',
}

async function call(path, init = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status} ${text.slice(0, 300)}`)
  return text === '' ? undefined : JSON.parse(text)
}

/** Release body: the PORT-NOTES summary, trimmed to GitHub's 125k limit. */
function releaseBody() {
  const notes = join(dist, 'PORT-NOTES.md')
  if (!existsSync(notes)) return `dsh-unrestricted ${version}`
  return readFileSync(notes, 'utf8').slice(0, 120_000)
}

try {
  console.log(`repo ${repo} · tag ${tag} · dist ${dist}`)
  let release
  try {
    release = await call(`/repos/${repo}/releases/tags/${tag}`)
    console.log(`release ${tag} already exists (id ${release.id}), uploading missing assets`)
  } catch {
    release = await call(`/repos/${repo}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: pkg.gitBranch ?? 'main',
        name: `v${version} · DSH Go 手机端适配`,
        body: releaseBody(),
        draft,
        prerelease: false,
      }),
    })
    console.log(`created release ${tag} (id ${release.id})`)
  }

  const existing = new Set((release.assets ?? []).map(asset => asset.name))
  for (const name of ASSETS) {
    if (existing.has(name)) {
      console.log(`  = ${name} (already attached)`)
      continue
    }
    const file = join(dist, name)
    const body = readFileSync(file)
    const contentType = name.endsWith('.json') ? 'application/json'
      : name.endsWith('.md') ? 'text/markdown; charset=utf-8'
        : name.endsWith('.tgz') ? 'application/gzip'
          : name.endsWith('.patch') ? 'text/plain; charset=utf-8'
            : 'application/octet-stream'
    const response = await fetch(
      `${UPLOAD_API}/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(basename(name))}`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType, 'Content-Length': String(statSync(file).size) },
        body,
      },
    )
    if (!response.ok) throw new Error(`upload ${name} → ${response.status} ${(await response.text()).slice(0, 300)}`)
    console.log(`  + ${name} (${statSync(file).size} B)`)
  }

  console.log(`\nok: https://github.com/${repo}/releases/tag/${tag}`)
} catch (error) {
  console.error(`failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
