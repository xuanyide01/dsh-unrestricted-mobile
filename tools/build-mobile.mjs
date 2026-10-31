#!/usr/bin/env node
/**
 * Build the phone-ready bundle: the exact directory the DSH Go terminal
 * installs from, plus a tarball and checksums for people who copy files over
 * adb instead of git.
 *
 * Usage:
 *   node tools/build-mobile.mjs [--out <dir>] [--skip-tar]
 *
 * Output:
 *   <out>/dsh-unrestricted/                 ← install this directory
 *   <out>/dsh-unrestricted-<version>.tgz     ← same tree, one file
 *   <out>/SHA256SUMS.txt                     ← digests of both
 *   <out>/INSTALL-mobile.md                  ← copy of docs/mobile-install.md
 *
 * The directory is what `dsh plugin --profile web add <dir>` links into the
 * phone's profile, so it must contain no node_modules and no build leftovers.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

const outDir = resolve(arg('out', join(pkgDir, 'dist')))
const skipTar = process.argv.includes('--skip-tar')
const stage = join(outDir, pkg.name)

/** Files that must exist for the package to boot. */
const REQUIRED = ['src/node.js', 'src/deps.js', 'src/rules.js', 'src/mobile.js', 'src/mobile-view.js', 'package.json', 'cordis.patch.yml']

/** Directories copied whole (the `files` list in package.json). */
const ENTRIES = pkg.files ?? ['src', 'lib', 'docs', 'cordis.patch.yml', 'README.md', 'LICENSE']

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stats = statSync(path)
    if (stats.isDirectory()) walk(path, base, acc)
    else acc.push(relative(base, path))
  }
  return acc
}

for (const entry of REQUIRED) {
  if (!existsSync(join(pkgDir, entry))) throw new Error(`missing required file: ${entry}`)
}

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

let copied = 0
for (const entry of ENTRIES) {
  const from = join(pkgDir, entry)
  if (!existsSync(from)) {
    console.warn(`skip missing ${entry}`)
    continue
  }
  if (statSync(from).isDirectory()) {
    for (const file of walk(from)) {
      const target = join(stage, entry, file)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(from, file), target)
      copied++
    }
  } else {
    copyFileSync(from, join(stage, entry))
    copied++
  }
}

// package.json is always shipped, even though `files` never lists it.
copyFileSync(join(pkgDir, 'package.json'), join(stage, 'package.json'))
copied++

// Guard rails: a linked install must never carry a second node_modules.
for (const forbidden of ['node_modules', '.git', 'dist', 'tests', 'tools', 'pnpm-lock.yaml']) {
  if (existsSync(join(stage, forbidden))) throw new Error(`forbidden entry in the mobile bundle: ${forbidden}`)
}

if (!skipTar) {
  const tgz = join(outDir, `${pkg.name}-${pkg.version}.tgz`)
  rmSync(tgz, { force: true })
  const tar = spawnSync('tar', ['-czf', tgz, '-C', outDir, pkg.name], { stdio: 'inherit' })
  if (tar.status !== 0) throw new Error(`tar failed with status ${tar.status}`)
  console.log(`tarball: ${tgz}`)
}

const sums = []
for (const file of readdirSync(outDir)) {
  const path = join(outDir, file)
  if (!statSync(path).isFile()) continue
  if (!/\.(tgz|tar\.gz|zip)$/.test(file)) continue
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
  sums.push(`${digest}  ${file}`)
  console.log(`sha256  ${digest}  ${file}`)
}
if (sums.length > 0) writeFileSync(join(outDir, 'SHA256SUMS.txt'), sums.join('\n') + '\n')

// The install sheet travels with the bundle so the phone never needs the repo.
const installDoc = join(pkgDir, 'docs', 'mobile-install.md')
if (existsSync(installDoc)) copyFileSync(installDoc, join(outDir, 'INSTALL-mobile.md'))

const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))
if (manifest.dshGo?.v !== 1) throw new Error('packaged manifest lost its dshGo block')
console.log(`staged ${copied} files -> ${stage}`)
console.log(`version ${pkg.version}; dshGo actions=${manifest.dshGo.contributes['composer.actions'].length} strip=${manifest.dshGo.contributes['composer.strip'].length} panels=${manifest.dshGo.contributes.panels.length}`)
