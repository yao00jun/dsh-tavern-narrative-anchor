/**
 * Build Release Zip Package
 * 将插件打包为可供 GitHub Releases 直接发布的标准发布包
 */

import { existsSync, mkdirSync, readFileSync, rmSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const distDir = join(root, 'dist')

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true })
}

const includeItems = [
  'package.json',
  'index.mjs',
  'client.js',
  'verify.mjs',
  'INSTALL.md',
  'install.ps1',
  'run-install.cmd',
  'README.md',
  'LICENSE'
].filter(item => existsSync(join(root, item)))

const zipNames = [
  'dsh-tavern-narrative-anchor-v2.0.0.zip',
  'dsh-tavern-narrative-anchor-v1.0.0.zip'
]

console.log(`>>> 正在打包发布文件...`)

const mainZip = join(distDir, zipNames[0])
if (existsSync(mainZip)) rmSync(mainZip)

const psCommand = `Compress-Archive -Path ${includeItems.map(i => `"${join(root, i)}"`).join(', ')} -DestinationPath "${mainZip}" -Force`
execSync(`powershell -NoProfile -Command "${psCommand}"`, { stdio: 'inherit' })

for (let i = 1; i < zipNames.length; i++) {
  const target = join(distDir, zipNames[i])
  copyFileSync(mainZip, target)
}

console.log(`>>> 打包完成:`)
for (const name of zipNames) {
  console.log(`  - ${join(distDir, name)}`)
}
