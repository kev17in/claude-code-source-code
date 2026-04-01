#!/usr/bin/env node
/**
 * prepare-src.mjs — Pre-build source transformation
 *
 * This script patches the source tree to make it compilable without Bun:
 *   1. Replace `import { feature } from 'bun:bundle'` with our stub
 *   2. Replace `MACRO.X` references with runtime values
 *   3. Create missing type declarations
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

const VERSION = '2.1.88'

// ── Helpers ──────────────────────────────────────────────────────────────────

function walk(dir, ext = '.ts') {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...walk(full, ext))
    } else if (entry.name.endsWith(ext) || entry.name.endsWith('.tsx')) {
      results.push(full)
    }
  }
  return results
}

function patchFile(filePath) {
  let src = fs.readFileSync(filePath, 'utf8')
  let changed = false

  // Repair merged statements (newline was eaten by a previous \s* in stub path regex)
  if (/stubs\/bun-bundle\.js['"]\s*(?:import|export)\b/.test(src)) {
    src = src.replace(
      /(stubs\/bun-bundle\.js)(['"])\s*(import|export)\b/g,
      '$1$2\n$3',
    )
    changed = true
  }

  // 1. Replace `import { feature } from 'bun:bundle'` / `"bun:bundle"`
  if (src.includes("from 'bun:bundle'") || src.includes('from "bun:bundle"')) {
    src = src.replace(/import\s*\{\s*feature\s*\}\s*from\s*['"]bun:bundle['"]/g,
      "import { feature } from '../stubs/bun-bundle.js'")
    // Fix relative depth based on file location
    const rel = path.relative(SRC, path.dirname(filePath))
    const n = rel ? rel.split(/[/\\]/).filter(Boolean).length : 0
    // src/foo.ts → ../stubs ; src/a/b.ts → ../../../stubs (up through each subdir + out of src/)
    const depth = n > 0 ? '../'.repeat(n + 1) : ''
    if (depth) {
      src = src.replace("from '../stubs/bun-bundle.js'", `from '${depth}stubs/bun-bundle.js'`)
    }
    changed = true
  }

  // 2. Replace MACRO.X with string literals
  const macroReplacements = {
    'MACRO.VERSION': `'${VERSION}'`,
    'MACRO.BUILD_TIME': `'${new Date().toISOString()}'`,
    'MACRO.FEEDBACK_CHANNEL': `'https://github.com/anthropics/claude-code/issues'`,
    'MACRO.ISSUES_EXPLAINER': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
    'MACRO.NATIVE_PACKAGE_URL': `'@anthropic-ai/claude-code'`,
    'MACRO.PACKAGE_URL': `'@anthropic-ai/claude-code'`,
    'MACRO.VERSION_CHANGELOG': `''`,
  }

  for (const [macro, replacement] of Object.entries(macroReplacements)) {
    if (src.includes(macro)) {
      // Don't replace inside strings
      src = src.replace(new RegExp(`(?<![\\w'"])${macro.replace('.', '\\.')}(?![\\w'" ])`, 'g'), replacement)
      changed = true
    }
  }

  // Normalize `stubs/bun-bundle.js` import depth (idempotent; fixes nested dirs)
  if (src.includes('stubs/bun-bundle.js')) {
    const rel = path.relative(SRC, path.dirname(filePath))
    const n = rel ? rel.split(/[/\\]/).filter(Boolean).length : 0
    const want = '../'.repeat(n + 1)
    // Only horizontal whitespace after closing quote — never eat newlines
    const stubImportRe =
      /import\s*\{\s*feature\s*\}\s*from\s*(['"])((?:\.\.\/)+)stubs\/bun-bundle\.js\1[ \t]*;?/g
    const next = src.replace(stubImportRe, (full, q, got) => {
      if (got === want) return full
      changed = true
      return `import { feature } from ${q}${want}stubs/bun-bundle.js${q}`
    })
    src = next
  }

  if (changed) {
    fs.writeFileSync(filePath, src, 'utf8')
    return true
  }
  return false
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('🔧 Preparing source files...\n')

const files = walk(SRC)
let patched = 0

for (const file of files) {
  if (patchFile(file)) {
    patched++
    console.log(`  patched: ${path.relative(ROOT, file)}`)
  }
}

// Create stub for bun:ffi (only used in upstreamproxy)
const ffiStub = path.join(ROOT, 'stubs', 'bun-ffi.ts')
if (!fs.existsSync(ffiStub)) {
  fs.writeFileSync(ffiStub, `// Stub for bun:ffi — not available outside Bun runtime\nexport const ffi = {} as any\nexport function dlopen() { return {} }\n`)
  console.log('  created: stubs/bun-ffi.ts')
}

// Create global MACRO type declaration
const macroDecl = path.join(ROOT, 'stubs', 'global.d.ts')
fs.writeFileSync(macroDecl, `// Global compile-time macros (normally injected by Bun bundler)
declare const MACRO: {
  VERSION: string
  BUILD_TIME: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  NATIVE_PACKAGE_URL: string
  PACKAGE_URL: string
  VERSION_CHANGELOG: string
}
`)
console.log('  created: stubs/global.d.ts')

console.log(`\n✅ Patched ${patched} / ${files.length} source files`)
