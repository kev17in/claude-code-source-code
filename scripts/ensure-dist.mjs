#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'dist', 'cli.cjs')
if (!existsSync(cli)) {
  console.error('Missing dist/cli.cjs. Run: npm run build')
  process.exit(1)
}
