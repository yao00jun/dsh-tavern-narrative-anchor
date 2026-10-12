/**
 * Build Release Zip Package
 * 将插件打包为可供 GitHub Releases 直接发布的标准发布包
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const distDir = join(root, 'dist')

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true })
}

const zipName = `${pkg.name}-v${pkg.version}.zip`
const zipPath = join(distDir, zipName)

if (existsSync(zipPath)) {
  rmSync(zipPath)
}

console.log(`>>> 正在打包发布文件: ${zipName}...`)

const includeItems = [
  'package.json',
  'cordis.patch.yml',
  'index.mjs',
  'client.js',
  'run-install.cmd',
  'install.ps1',
  'README.md',
  'LICENSE',
  'lib'
]

// 使用 PowerShell Compress-Archive 打包
const psCommand = `Compress-Archive -Path ${includeItems.map(i => `"${join(root, i)}"`).join(', ')} -DestinationPath "${zipPath}" -Force`
execSync(`powershell -NoProfile -Command "${psCommand}"`, { stdio: 'inherit' })

console.log(`>>> 打包完成: ${zipPath}`)
