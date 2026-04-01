#!/usr/bin/env node
/**
 * build.mjs — Best-effort build of Claude Code v2.1.88 from source
 *
 * ⚠️  IMPORTANT: A complete rebuild requires the Bun runtime's compile-time
 *     intrinsics (feature(), MACRO, bun:bundle). This script provides a
 *     best-effort build using esbuild. See KNOWN_ISSUES.md for details.
 *
 * What this script does:
 *   1. Copy src/ → build-src/ (original untouched)
 *   2. Replace `feature('X')` → `false`  (compile-time → runtime)
 *   3. Replace `MACRO.VERSION` etc → string literals
 *   4. Replace `import from 'bun:bundle'` → stub
 *   5. Create stubs for missing feature-gated modules
 *   6. Bundle with esbuild → dist/cli.cjs (CJS: repo has "type":"module")
 *
 * Requirements: Node.js >= 18, npm
 * Usage:       node scripts/build.mjs
 */

import { readdir, readFile, writeFile, mkdir, cp, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, resolve, normalize, relative, basename, extname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const VERSION = '2.1.88'
const BUILD = join(ROOT, 'build-src')
const ENTRY = join(BUILD, 'entry.ts')

// ── Helpers ────────────────────────────────────────────────────────────────

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory() && e.name !== 'node_modules') yield* walk(p)
    else yield p
  }
}

async function exists(p) { try { await stat(p); return true } catch { return false } }

/** Map esbuild error path (often `src/foo.ts` relative to repo) to absolute path under build-src. */
function resolveImporterFromEsbuildPath(raw, BUILD, ROOT) {
  const n = raw.replace(/\\/g, '/').trim()
  if (/^[A-Za-z]:[\\/]/.test(n) || n.startsWith('/')) return normalize(n)
  if (n.startsWith('build-src/')) return normalize(join(ROOT, n))
  if (n.startsWith('src/')) return normalize(join(BUILD, n))
  const underSrc = join(BUILD, 'src', n)
  if (existsSync(underSrc) || existsSync(underSrc + '.ts') || existsSync(underSrc + '.tsx'))
    return normalize(underSrc)
  const underBuild = join(BUILD, n)
  if (existsSync(underBuild) || existsSync(underBuild + '.ts')) return normalize(underBuild)
  return normalize(join(BUILD, 'src', n))
}

/** Resolve stub file path from esbuild "Could not resolve" errors (uses importer path for relative specs). */
function isInsideDir(file, dir) {
  const rel = relative(normalize(dir), normalize(file))
  return !rel.startsWith('..')
}

async function createStubsFromErrors(errors, BUILD, ROOT) {
  let stubCount = 0
  const buildRoot = normalize(BUILD)
  const seen = new Set()

  for (const err of errors) {
    const m = err.text?.match(/Could not resolve "([^"]+)"/)
    if (!m) continue
    const spec = m[1]
    if (spec.startsWith('node:') || spec.startsWith('bun:')) continue

    let absPath = null
    if (spec.startsWith('@')) continue

    let importerFile = err.location?.file
    if (importerFile) {
      importerFile = normalize(importerFile)
      if (!/^[A-Za-z]:[\\/]/.test(importerFile) && !importerFile.startsWith('/')) {
        importerFile = resolveImporterFromEsbuildPath(importerFile, BUILD, ROOT)
      }
    }
    if (!importerFile && err.text) {
      const mr = err.text.match(/^(.+):(\d+):(\d+):\s*ERROR:\s*Could not resolve/)
      if (mr) importerFile = resolveImporterFromEsbuildPath(mr[1], BUILD, ROOT)
    }

    if (importerFile && spec.startsWith('.')) {
      absPath = normalize(resolve(dirname(importerFile), spec))
    } else if (
      !spec.startsWith('.') &&
      (spec.includes('/') || spec.includes('\\')) &&
      !/^[A-Za-z]:[\\/]/.test(spec) &&
      !spec.startsWith('/')
    ) {
      absPath = normalize(join(BUILD, 'src', spec))
    } else {
      continue
    }

    if (!absPath || absPath.includes('\0')) continue
    if (!isInsideDir(absPath, buildRoot)) continue

    let target = absPath
    const hasExt = /\.[a-zA-Z0-9]+$/.test(basename(absPath))
    const isText = /\.(txt|md|json)$/i.test(target)
    const isCode = /\.[cm]?[tj]sx?$/i.test(target)

    if (!hasExt) {
      target = `${absPath}.ts`
    } else if (!isText && !isCode) {
      continue
    }

    if (seen.has(target)) continue
    seen.add(target)

    await mkdir(dirname(target), { recursive: true }).catch(() => {})
    if (await exists(target)) {
      const head = (await readFile(target, 'utf8')).slice(0, 120)
      if (!head.includes('Auto-generated stub')) continue
    }

    if (/\.json$/i.test(target)) {
      await writeFile(target, '{}', 'utf8')
    } else if (/\.(txt|md)$/i.test(target)) {
      await writeFile(target, '', 'utf8')
    } else {
      const baseName = basename(target, extname(target))
      const safeName = baseName.replace(/[^a-zA-Z0-9_$]/g, '_') || 'stub'
      const body = `// Auto-generated stub\nexport function ${safeName}() {\n  return undefined\n}\nexport default ${safeName}\n`
      await writeFile(target, body, 'utf8')
    }
    stubCount++
  }
  return stubCount
}

async function ensureEsbuild() {
  try { execSync('npx esbuild --version', { stdio: 'pipe' }) }
  catch {
    console.log('📦 Installing esbuild...')
    execSync('npm install --save-dev esbuild', { cwd: ROOT, stdio: 'inherit' })
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1: Copy source
// ══════════════════════════════════════════════════════════════════════════════

await rm(BUILD, { recursive: true, force: true })
await mkdir(BUILD, { recursive: true })
await cp(join(ROOT, 'src'), join(BUILD, 'src'), { recursive: true })
await cp(join(ROOT, 'stubs'), join(BUILD, 'stubs'), { recursive: true })
console.log('✅ Phase 1: Copied src/ + stubs/ → build-src/')

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Transform source
// ══════════════════════════════════════════════════════════════════════════════

let transformCount = 0

// MACRO replacements
const MACROS = {
  'MACRO.VERSION': `'${VERSION}'`,
  'MACRO.BUILD_TIME': `''`,
  'MACRO.FEEDBACK_CHANNEL': `'https://github.com/anthropics/claude-code/issues'`,
  'MACRO.ISSUES_EXPLAINER': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
  'MACRO.FEEDBACK_CHANNEL_URL': `'https://github.com/anthropics/claude-code/issues'`,
  'MACRO.ISSUES_EXPLAINER_URL': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
  'MACRO.NATIVE_PACKAGE_URL': `'@anthropic-ai/claude-code'`,
  'MACRO.PACKAGE_URL': `'@anthropic-ai/claude-code'`,
  'MACRO.VERSION_CHANGELOG': `''`,
}

for await (const file of walk(join(BUILD, 'src'))) {
  if (!file.match(/\.[tj]sx?$/)) continue

  let src = await readFile(file, 'utf8')
  let changed = false

  // 2a. feature('X') → false
  if (/\bfeature\s*\(\s*['"][A-Z_]+['"]\s*\)/.test(src)) {
    src = src.replace(/\bfeature\s*\(\s*['"][A-Z_]+['"]\s*\)/g, 'false')
    changed = true
  }

  // 2b. MACRO.X → literals
  for (const [k, v] of Object.entries(MACROS)) {
    if (src.includes(k)) {
      src = src.replaceAll(k, v)
      changed = true
    }
  }

  // 2c. Remove bun:bundle import (feature() is already replaced)
  if (src.includes("from 'bun:bundle'") || src.includes('from "bun:bundle"')) {
    src = src.replace(/import\s*\{\s*feature\s*\}\s*from\s*['"]bun:bundle['"];?\n?/g, '// feature() replaced with false at build time\n')
    changed = true
  }

  // 2d. Remove type-only import of global.d.ts
  if (src.includes("import '../global.d.ts'") || src.includes("import './global.d.ts'")) {
    src = src.replace(/import\s*['"][.\/]*global\.d\.ts['"];?\n?/g, '')
    changed = true
  }

  if (changed) {
    await writeFile(file, src, 'utf8')
    transformCount++
  }
}
console.log(`✅ Phase 2: Transformed ${transformCount} files`)

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 3: Create entry wrapper
// ══════════════════════════════════════════════════════════════════════════════

await writeFile(ENTRY, `// Claude Code v${VERSION} — built from source (esbuild entry; shebang from banner)
// Copyright (c) Anthropic PBC. All rights reserved.
import './src/entrypoints/cli.tsx'
`, 'utf8')
console.log('✅ Phase 3: Created entry wrapper')

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4: Iterative stub + bundle
// ══════════════════════════════════════════════════════════════════════════════

await ensureEsbuild()

const OUT_DIR = join(ROOT, 'dist')
await mkdir(OUT_DIR, { recursive: true })
const OUT_FILE = join(OUT_DIR, 'cli.cjs')

// Run up to 5 rounds of: esbuild → collect missing → create stubs → retry
const MAX_ROUNDS = 12
let succeeded = false

const bannerJs =
  `#!/usr/bin/env node\n// Claude Code v${VERSION} (built from source)\n// Copyright (c) Anthropic PBC. All rights reserved.\n`

for (let round = 1; round <= MAX_ROUNDS; round++) {
  console.log(`\n🔨 Phase 4 round ${round}/${MAX_ROUNDS}: Bundling...`)

  let errors = []
  try {
    const result = await esbuild.build({
      absWorkingDir: BUILD,
      entryPoints: ['entry.ts'],
      bundle: true,
      platform: 'node',
      target: 'node18',
      // CJS: many deps (e.g. commander) use dynamic require('node:*'); ESM bundle shim breaks that.
      format: 'cjs',
      outfile: OUT_FILE,
      banner: { js: bannerJs },
      packages: 'bundle',
      external: ['bun:*'],
      allowOverwrite: true,
      logLevel: 'silent',
      sourcemap: true,
      loader: {
        '.md': 'text',
        '.txt': 'text',
      },
      // tsconfig paths `src/*` → project root `src/`; force bundled copy under build-src/src
      alias: {
        src: join(BUILD, 'src'),
      },
    })
    errors = result.errors
    if (errors.length === 0) {
      succeeded = true
      break
    }
  } catch (e) {
    errors = e.errors || []
    if (errors.length === 0) {
      console.log('❌ Unrecoverable errors:', e?.message || e)
      break
    }
  }

  const resolveErrors = errors.filter((e) => /Could not resolve/.test(e.text))
  console.log(`   Found ${resolveErrors.length} resolve errors, stubbing...`)

  const stubCount = await createStubsFromErrors(errors, BUILD, ROOT)
  console.log(`   Created ${stubCount} stubs`)

  if (stubCount === 0) {
    const errLines = errors.map((e) => e.text).slice(0, 8)
    console.log('❌ Unrecoverable errors (no stubs written):')
    errLines.forEach((l) => console.log('   ' + l))
    break
  }
}

if (succeeded) {
  const size = (await stat(OUT_FILE)).size
  console.log(`\n✅ Build succeeded: ${OUT_FILE}`)
  console.log(`   Size: ${(size / 1024 / 1024).toFixed(1)}MB`)
  console.log(`\n   Usage:  node ${OUT_FILE} --version`)
  console.log(`           node ${OUT_FILE} -p "Hello"`)
} else {
  console.error('\n❌ Build failed after all rounds.')
  console.error('   The transformed source is in build-src/ for inspection.')
  console.error('\n   To fix manually:')
  console.error('   1. Check build-src/ for the transformed files')
  console.error('   2. Create missing stubs in build-src/src/')
  console.error('   3. Re-run: node scripts/build.mjs')
  process.exit(1)
}
