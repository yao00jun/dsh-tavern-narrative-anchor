// Narrative Anchor v2 — 安装自检（只读，不改任何东西）
// 用法：node verify.mjs [DSH_HOME]      // 不传则按脚本所在位置推断
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = path.dirname(fileURLToPath(import.meta.url))
// 插件位于 <DSH_HOME>/profile-data/tavern/data/plugins/narrative-anchor
// ⇒ 从插件目录往上 5 层才是 <DSH_HOME>（narrative-anchor → plugins → data → tavern → profile-data → DSH_HOME）
const DSH_HOME = path.resolve(process.argv[2] || path.resolve(pluginDir, '..', '..', '..', '..', '..'))

const EXPECTED = {
  'package.json': 'df661bd5cb6c1da740470c368c9317d6ffc77369ebde90587a133f297de2f9d6',
  'index.mjs': 'ed3ae05baaf0b05eba12eea385fc53cbc942752598fe420b6c2e355e82c862f2',
  'client.js': '475752a9fa728eface19de21a88f31a581d65d7e5b3c256293da1f7b6edfb672',
}
let failed = 0
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) failed++ }
const warn = (label, pass, detail = '') => { if (!pass) console.log(`WARN  ${label}${detail ? '  — ' + detail : ''}`) }

console.log('插件目录      : ' + pluginDir)
console.log('推断 DSH_HOME : ' + DSH_HOME + '\n')

console.log('【1】包内文件完整性')
for (const [name, sha] of Object.entries(EXPECTED)) {
  const file = path.join(pluginDir, name)
  if (!existsSync(file)) { ok(name + ' 存在', false); continue }
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
  ok(name.padEnd(14) + 'sha256', actual === sha, actual === sha ? '' : `期望 ${sha.slice(0, 8)}… 实际 ${actual.slice(0, 8)}…（文件可能被改过）`)
}

console.log('\n【2】Tavern 安装与宿主能力')
const releaseFile = path.join(DSH_HOME, 'apps', 'dsh-tavern', '.dsh-tavern-release.json')
ok('找到 Tavern（apps/dsh-tavern）', existsSync(releaseFile), existsSync(releaseFile) ? '' : '找不到：DSH_HOME 推断错了，可改用 node verify.mjs <DSH_HOME>')
if (existsSync(releaseFile)) {
  try { const j = JSON.parse(readFileSync(releaseFile, 'utf8')); console.log('      Tavern commit = ' + String(j.commit || '').slice(0, 8) + '（装于 ' + j.installedAt + '）') } catch {}
}
const apiFile = path.join(DSH_HOME, 'apps', 'dsh-tavern', 'tavern-plugin', 'lib', 'plugin-api.js')
if (existsSync(apiFile)) {
  const text = readFileSync(apiFile, 'utf8')
  ok('宿主提供 Plugin API v2', /TAVERN_PLUGIN_API_VERSION\s*=\s*2/.test(text), '没有 API v2 时插件会被 Tavern 安全跳过（只记日志，不影响启动）')
  ok('宿主提供 compactionSection', text.includes('compactionSection('))
  ok('宿主提供 worldbookEntries', text.includes('worldbookEntries('))
  ok('宿主提供 settlementTool', text.includes('settlementTool('))
} else ok('找到 tavern-plugin/lib/plugin-api.js', false, apiFile)

console.log('\n【3】Tavern 是否已登记本插件（需至少启动过一次 Tavern）')
const guard = path.join(pluginDir, '.tavern-entry.mjs')
warn('已生成 .tavern-entry.mjs', existsSync(guard), '若刚复制完还没启动过 Tavern，这条 WARN 属正常')
const patchFile = path.join(DSH_HOME, 'profiles', 'tavern', 'cordis.patch.yml')
if (existsSync(patchFile)) {
  const text = readFileSync(patchFile, 'utf8')
  warn('cordis.patch.yml 已含 tavern-user-plugin-narrative-anchor-v2', text.includes('tavern-user-plugin-narrative-anchor-v2'), '同上，启动一次后 Tavern 会自动写入')
} else warn('找到 profiles/tavern/cordis.patch.yml', false, patchFile)

console.log('\n结论：' + (failed === 0
  ? '关键项全部通过 ✅  下一步：重启 DSH Tavern，再从右侧栏「＋」→「叙事锚定」打开面板'
  : `有 ${failed} 项 FAIL ❌  请按上面每一项的说明处理`))
