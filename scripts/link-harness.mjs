/**
 * Link every @deepseek-ai package from a harness checkout into this
 * package's node_modules, so TypeScript (moduleResolution: bundler) and
 * tsdown resolve them through their real package.json exports — exactly as a
 * profile install would. Idempotent; re-run by `pnpm run typecheck`.
 *
 * The harness root defaults to the sibling checkout ../deepseek-harness and
 * can be overridden with DSH_HARNESS_ROOT.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const harnessRoot = resolve(
  packageDir,
  process.env.DSH_HARNESS_ROOT ?? '../../deepseek-harness',
)

/** Collect (name, dir) for every harness package with an @deepseek-ai name. */
function scanPackages() {
  const found = new Map()
  const roots = ['packages', 'vendor']
  for (const root of roots) {
    const groups = readdirSync(join(harnessRoot, root), { withFileTypes: true })
    for (const group of groups) {
      if (!group.isDirectory()) continue
      const members = readdirSync(join(harnessRoot, root, group.name), { withFileTypes: true })
      for (const member of members) {
        if (!member.isDirectory()) continue
        const manifestPath = join(harnessRoot, root, group.name, member.name, 'package.json')
        let manifest
        try {
          manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        } catch {
          continue
        }
        if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/')) {
          found.set(manifest.name, join(harnessRoot, root, group.name, member.name))
        }
      }
    }
  }
  return found
}

const packages = scanPackages()
if (packages.size === 0) {
  throw new Error(`no @deepseek-ai packages found under ${harnessRoot} — is DSH_HARNESS_ROOT correct?`)
}

const scopeDir = join(packageDir, 'node_modules', '@deepseek-ai')
mkdirSync(scopeDir, { recursive: true })

// Drop stale links this script no longer owns (package renamed/removed),
// then (re)create every link. Foreign entries pnpm owns are left alone.
const existing = new Set(readdirSync(scopeDir))
for (const link of existing) {
  if (!packages.has(`@deepseek-ai/${link}`)) {
    rmSync(join(scopeDir, link), { force: true })
  }
}
for (const [name, target] of packages) {
  const linkPath = join(scopeDir, name.slice('@deepseek-ai/'.length))
  rmSync(linkPath, { force: true })
  symlinkSync(target, linkPath, 'dir')
}
console.log(`linked ${packages.size} @deepseek-ai packages from ${harnessRoot}`)
