// Narrative Anchor adapted to DSH Tavern's stable Plugin API v2.
// Deliberately additive: never registers replaceSettlement and never reads Tavern internals.
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'narrative-anchor-v2'
export const inject = ['tavern']

const TOOL_NAME = 'narrative_anchor_submit'
const MAX_STM = 500
const MAX_FACTS = 200
const MAX_ITEMS = 200
const MAX_STATE_BYTES = 56 * 1024
const MAX_TEXT = 3500
const MAX_KEYS = 8
const MAX_TITLE = 120
const MAX_GLOBAL_BYTES = 2 * 1024 * 1024
const pluginDir = dirname(fileURLToPath(import.meta.url))
const globalFile = join(pluginDir, 'data', 'global.json')
const emptyGlobal = () => ({ version: 1, worldbooks: [], families: [], updatedAt: Date.now() })

async function readGlobal() {
  try {
    const value = JSON.parse(await readFile(globalFile, 'utf8'))
    return value && value.version === 1 ? { ...emptyGlobal(), ...value } : emptyGlobal()
  } catch (error) {
    if (error.code === 'ENOENT') return emptyGlobal()
    throw new Error('Narrative Anchor 全局书库读取失败：' + String(error.message || error))
  }
}

async function writeGlobal(value) {
  const text = JSON.stringify({ ...value, version: 1, updatedAt: Date.now() }, null, 2)
  if (Buffer.byteLength(text, 'utf8') > MAX_GLOBAL_BYTES) throw new Error('全局书库不能超过 2 MB')
  await mkdir(dirname(globalFile), { recursive: true })
  const tmp = globalFile + '.tmp-' + process.pid + '-' + Date.now()
  try { await writeFile(tmp, text, { encoding: 'utf8', flag: 'wx' }); await rename(tmp, globalFile) }
  catch (error) { try { await unlink(tmp) } catch {}; throw error }
  return JSON.parse(text)
}

const emptyState = () => ({
  version: 1,
  updatedAt: Date.now(),
  currentState: { time: '', world: '', location: '', characters: [], environment: [], items: [], focus: '' },
  stm: [],
  ltm: [],
  knownFacts: [],
  foreshadowing: [],
  memoryTree: [],
  memorySeq: 0,
  plotRoute: { currentNode: '', recap: '', nextScene: '', foreshadowing: [] },
})

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function cleanText(value, max = MAX_TEXT) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function cleanList(value, max = MAX_ITEMS) {
  if (!Array.isArray(value)) return undefined
  return [...new Set(value.map(item => cleanText(item, 160)).filter(Boolean))].slice(0, max)
}
function cleanKeys(value) { return cleanList(value, MAX_KEYS) || [] }

// 记忆树（对齐原版 v0.9.25 的多级记忆）：未归并 STM 每 7 条合成 depth1 叶节点，
// 同深度每 5 个节点合成上一层；根节点超过 10 个由程序兜底合并。被合成的子节点从树中移除，
// 因此树只保留"当前根 + 各级未满的零头"，体积有界。
const FOLD_LEAF = 7
const FOLD_LEVEL = 5
const ROOT_LIMIT = 10
const MAX_TREE_NODES = 60

function digestText(parts, limit) {
  const text = parts.map(part => cleanText(part, 700)).filter(Boolean).join(' / ')
  return text.length > limit ? text.slice(0, limit) + '…' : text
}

function foldMemoryTree(state) {
  const tree = Array.isArray(state.memoryTree)
    ? state.memoryTree.map(node => ({ ...node, children: [...(node.children || [])], from: [...(node.from || [])], keys: [...(node.keys || [])] }))
    : []
  let seq = Number(state.memorySeq) || 0
  const levelOf = depth => tree.filter(node => Number(node.depth) === depth)
  const topDepth = () => tree.reduce((max, node) => Math.max(max, Number(node.depth) || 1), 0)
  const makeNode = (depth, members, kind) => {
    const from = [...new Set(members
      .flatMap(item => (Array.isArray(item.from) && item.from.length ? item.from : [Number(item.turn)]))
      .filter(Number.isFinite))].sort((a, b) => a - b)
    const first = from.length ? from[0] : 0, last = from.length ? from[from.length - 1] : 0
    const node = { id: `n${depth}-${++seq}`, depth, from: from.slice(0, 200),
      children: members.map(item => item.id).filter(Boolean), keys: cleanKeys(members.flatMap(item => item.keys || [])),
      title: kind === 'leaf' ? `第 ${first}–${last} 轮` : `第 ${first}–${last} 轮（${members.length} 段汇总）`,
      summary: digestText(members.map(item => item.summary || item.title), depth === 1 ? 500 : 400), createdAt: Date.now() }
    tree.push(node)
    return node
  }
  let unmerged = (state.stm || []).filter(row => !row.mergedInto)
  while (unmerged.length >= FOLD_LEAF) {
    const group = unmerged.slice(0, FOLD_LEAF)
    unmerged = unmerged.slice(FOLD_LEAF)
    const node = makeNode(1, group, 'leaf')
    for (const row of group) row.mergedInto = node.id
  }
  for (let depth = 1; depth <= 12; depth++) {
    while (levelOf(depth).length >= FOLD_LEVEL) {
      const group = levelOf(depth).slice(0, FOLD_LEVEL)
      for (const item of group) tree.splice(tree.indexOf(item), 1)
      makeNode(depth + 1, group, 'level')
    }
  }
  for (let guard = 0; guard < 50; guard++) {
    const depth = topDepth()
    const roots = levelOf(depth)
    if (roots.length <= ROOT_LIMIT) break
    const group = roots.slice(0, roots.length - ROOT_LIMIT + 1)
    for (const item of group) tree.splice(tree.indexOf(item), 1)
    makeNode(depth + 1, group, 'root')
  }
  state.memorySeq = seq
  state.memoryTree = tree.slice(-MAX_TREE_NODES)
  return state
}

/** 记忆树的根节点（不被任何节点引用），按历史顺序。 */
function memoryRoots(state) {
  const tree = Array.isArray(state?.memoryTree) ? state.memoryTree : []
  const referenced = new Set(tree.flatMap(node => node.children || []))
  return tree.filter(node => !referenced.has(node.id)).sort((a, b) => (a.from?.[0] || 0) - (b.from?.[0] || 0))
}
function stableFactId(title) {
  let hash = 2166136261
  for (const char of String(title || '')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619) }
  return 'fact-' + (hash >>> 0).toString(36)
}
function safeEntryId(value, prefix = 'entry') {
  const raw = cleanText(value, 64)
  const slug = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52)
  return slug || `${prefix}-${stableFactId(raw || String(Date.now()))}`
}
function cleanRecordArray(value, limit, map) {
  if (!Array.isArray(value)) return undefined
  return value.slice(-limit).map(map).filter(Boolean)
}
function mergeState(previousValue, args, { turn, text, maxStm, maxStmRows = 1, maxLtmRows = 8, maxFactRows = 20 }) {
  const previous = object(previousValue)
  const next = {
    ...emptyState(),
    ...previous,
    currentState: { ...emptyState().currentState, ...object(previous.currentState) },
    plotRoute: { ...emptyState().plotRoute, ...object(previous.plotRoute) },
    stm: Array.isArray(previous.stm) ? [...previous.stm] : [],
    ltm: Array.isArray(previous.ltm) ? [...previous.ltm] : [],
    knownFacts: Array.isArray(previous.knownFacts) ? [...previous.knownFacts] : [],
  }
  const input = object(args)
  const current = object(input.current_state)
  for (const key of ['time', 'world', 'location', 'focus']) {
    if (Object.hasOwn(current, key)) next.currentState[key] = cleanText(current[key], key === 'focus' ? 400 : 300)
  }
  for (const [from, to] of [['characters', 'characters'], ['environment', 'environment'], ['items', 'items']]) {
    const values = cleanList(current[from])
    if (values !== undefined) next.currentState[to] = values
  }

  const route = object(input.plot_route)
  for (const [from, to] of [['current_node', 'currentNode'], ['recap', 'recap'], ['next_scene', 'nextScene']]) {
    if (Object.hasOwn(route, from)) next.plotRoute[to] = cleanText(route[from], 1000)
  }
  const foreshadowing = cleanList(route.foreshadowing, 80)
  if (foreshadowing !== undefined) next.plotRoute.foreshadowing = foreshadowing

  const memory = object(input.memory)
  const stmRows = cleanRecordArray(memory.stm, maxStmRows, row => {
    row = object(row)
    const summary = cleanText(row.summary)
    if (!summary) return null
    return { turn, title: cleanText(row.title, MAX_TITLE) || `第 ${turn} 轮`, summary, time: next.currentState.time, location: next.currentState.location }
  })
  if (stmRows?.length) next.stm = [...next.stm, ...stmRows].slice(-MAX_STM)
  const ltmRows = cleanRecordArray(memory.ltm, maxLtmRows, row => {
    row = object(row)
    const summary = cleanText(row.summary)
    if (!summary) return null
    return { turn, title: cleanText(row.title, MAX_TITLE) || '长期记忆', summary, keywords: cleanKeys(row.keywords) }
  })
  if (ltmRows?.length) next.ltm = [...next.ltm, ...ltmRows].slice(-80)

  const facts = cleanRecordArray(memory.known_facts, maxFactRows, row => {
    row = object(row)
    const entry = cleanText(row.entry, MAX_TITLE)
    const summary = cleanText(row.summary)
    if (!entry || !summary) return null
    return { id: stableFactId(entry), title: entry, summary, keys: cleanKeys(row.keywords), turn }
  })
  if (facts?.length) {
    const byId = new Map(next.knownFacts.map(row => [row.id, row]))
    for (const row of facts) byId.set(row.id, row)
    next.knownFacts = [...byId.values()].slice(-MAX_FACTS)
  }
  const foreshadowingRows = cleanRecordArray(memory.foreshadowing, 30, row => {
    row = object(row)
    const title = cleanText(row.title ?? row.entry, MAX_TITLE)
    if (!title) return null
    const closed = row.status === 'closed' || row.status === 'resolved' || row.resolved === true || row.done === true
    return { id: stableFactId(title), title, detail: cleanText(row.detail ?? row.summary ?? row.note, 600),
      status: closed ? 'closed' : 'open', turn, keys: cleanKeys(row.keywords) }
  })
  // 原版规则：伏笔库「完整替换」；已兑现的保留结果备查，但不再注入。
  if (foreshadowingRows) next.foreshadowing = foreshadowingRows.slice(-60)
  const legacyLinks = cleanList(route.foreshadowing, 40)
  if (legacyLinks?.length) {
    const byId = new Map((next.foreshadowing || []).map(row => [row.id, row]))
    for (const title of legacyLinks) {
      const id = stableFactId(title)
      if (!byId.has(id)) byId.set(id, { id, title, detail: '', status: 'open', turn, keys: [] })
    }
    next.foreshadowing = [...byId.values()].slice(-60)
  }
  next.stm = next.stm.filter(row => cleanText(row.summary))
  next.ltm = next.ltm.filter(row => cleanText(row.summary))
  next.knownFacts = next.knownFacts.filter(row => cleanText(row.summary))
  next.foreshadowing = (next.foreshadowing || []).filter(row => cleanText(row.title))
  next.maxStm = Math.max(1, Math.min(50, Number(maxStm) || 7))
  foldMemoryTree(next)
  next.updatedAt = Date.now()
  // The just-settled turn is retained as objective evidence and also helps the next task orient itself.
  // text 为空时（结算工具 / 回填路径）保留上一轮正文，供"关键词命中"标记使用。
  next.lastTurnText = cleanText(text, 5000) || cleanText(previous.lastTurnText, 5000)
  return next
}

function fitState(state) {
  const next = structuredClone(state)
  const bytes = () => Buffer.byteLength(JSON.stringify(next), 'utf8')
  while (bytes() > MAX_STATE_BYTES) {
    if (next.stm.length > 20) { next.stm.shift(); continue }
    if (next.knownFacts.length > 20) { next.knownFacts.shift(); continue }
    if (next.ltm.length > 10) { next.ltm.shift(); continue }
    if ((next.memoryTree || []).length > 4) { next.memoryTree.shift(); continue }
    const closedLinks = (next.foreshadowing || []).filter(row => row.status === 'closed')
    if (closedLinks.length > 8) {
      const keep = new Set(closedLinks.slice(-8))
      next.foreshadowing = next.foreshadowing.filter(row => row.status !== 'closed' || keep.has(row))
      continue
    }
    const openLinks = (next.foreshadowing || []).filter(row => row.status !== 'closed')
    if (openLinks.length > 30) {
      const keep = new Set(openLinks.slice(-30))
      next.foreshadowing = next.foreshadowing.filter(row => row.status === 'closed' || keep.has(row))
      continue
    }
    const longLink = (next.foreshadowing || []).find(row => cleanText(row.detail).length > 240)
    if (longLink) { longLink.detail = longLink.detail.slice(0, 240) + '…'; continue }
    const candidates = [...next.stm, ...next.knownFacts, ...next.ltm, ...(next.memoryTree || [])]
      .sort((a, b) => cleanText(a.summary).length - cleanText(b.summary).length)
    const target = candidates.find(row => cleanText(row.summary).length > 240)
    if (!target) throw new Error('叙事锚点数据超过安全存储上限，已拒绝提交')
    target.summary = target.summary.slice(0, 240) + '…'
  }
  return next
}

function statePrompt(state) {
  if (!state) return ''
  const lines = []
  const current = state.currentState || {}
  for (const [key, title] of [['time','时间'], ['world','世界'], ['location','地点'], ['focus','叙事备忘']]) {
    if (cleanText(current[key])) lines.push(`${title}：${cleanText(current[key], 400)}`)
  }
  for (const [key, title] of [['characters','在场人物'], ['environment','环境'], ['items','关键物品']]) {
    const values = cleanList(current[key]) || []
    if (values.length) lines.push(`${title}：${values.join('、')}`)
  }
  const route = state.plotRoute || {}
  if (route.currentNode) lines.push(`剧情节点：${cleanText(route.currentNode, 300)}`)
  if (route.recap) lines.push(`前情：${cleanText(route.recap, 600)}`)
  if (route.nextScene) lines.push(`后续方向：${cleanText(route.nextScene, 400)}`)
  const openLinks = (Array.isArray(state.foreshadowing) ? state.foreshadowing : []).filter(row => row.status !== 'closed')
  const legacyLinks = openLinks.length ? [] : (cleanList(route.foreshadowing, 40) || [])
  const linkLines = openLinks.length
    ? openLinks.map(row => `- ${cleanText(row.title, 120)}${cleanText(row.detail) ? '：' + cleanText(row.detail, 300) : ''}`)
    : legacyLinks.map(item => `- ${cleanText(item, 200)}`)
  if (linkLines.length) lines.push('活跃伏笔（未兑现）：\n' + linkLines.join('\n'))
  const roots = memoryRoots(state).slice(-ROOT_LIMIT)
  if (roots.length) lines.push('历忆树（按历史顺序）：\n' + roots.map(node => `- ${cleanText(node.title, 60)}：${cleanText(node.summary, 500)}`).join('\n'))
  const ltm = (state.ltm || []).slice(-12)
  if (ltm.length) lines.push('长期记忆（人工）：\n' + ltm.map(row => `- ${cleanText(row.title, 100)}：${cleanText(row.summary, 600)}`).join('\n'))
  const backfilled = (state.backfilledStm || []).slice(-10)
  if (backfilled.length) lines.push('历史回填记忆：\n' + backfilled.map(row => `- [第 ${row.turn} 轮·回填] ${cleanText(row.title, 100)}：${cleanText(row.summary, 500)}`).join('\n'))
  const recent = (state.stm || []).slice(-Math.max(1, Math.min(10, Number(state.maxStm) || 7)))
  if (recent.length) lines.push('近期记忆：\n' + recent.map(row => `- [第 ${row.turn} 轮] ${cleanText(row.title, 100)}：${cleanText(row.summary, 500)}`).join('\n'))
  return lines.length ? '【叙事锚点】\n' + lines.join('\n') : ''
}

export function apply(ctx) {
  const api = ctx.tavern
  const logger = ctx.logger || console
  if (!api || api.apiVersion < 2) throw new Error('Narrative Anchor 需要 Tavern Plugin API v2')

  const emptyPluginData = () => ({ version: 1, config: { maxStm: 7, injectPosition: 'before' }, worldbook: { entries: [], boundSharedIds: [], disabledGlobalIds: [] } })
  async function pluginData(gameId) {
    const raw = object(await api.readGameData({ gameId }))
    return { ...emptyPluginData(), ...raw,
      config: { ...emptyPluginData().config, ...object(raw.config) },
      worldbook: { ...emptyPluginData().worldbook, ...object(raw.worldbook) } }
  }
  const gameQueues = new Map()
  async function writePluginData(gameId, update) {
    const id = String(gameId)
    const previous = gameQueues.get(id) || Promise.resolve()
    const task = previous.catch(() => {}).then(async () => {
      const current = await pluginData(id)
      const next = update(current)
      const text = JSON.stringify(next)
      if (Buffer.byteLength(text, 'utf8') > 220 * 1024) throw new Error('本局锚点设置/临时世界书超过 220 KB，请清理条目或缩短正文')
      await api.saveGameData({ gameId: id, data: next })
      return next
    })
    gameQueues.set(id, task)
    try { return await task }
    finally { if (gameQueues.get(id) === task) gameQueues.delete(id) }
  }
  let globalQueue = Promise.resolve()
  let globalCache = emptyGlobal()
  const globalLoaded = readGlobal().then(value => { globalCache = value }).catch(error => {
    logger.warn?.('[Narrative Anchor] 全局书库读取失败：' + String(error?.message || error))
  })
  async function sharedValue() {
    await globalLoaded
    return globalCache
  }
  function sharedSnapshot() { return globalCache }
  async function updateShared(mutator) {
    const currentTask = globalQueue.catch(() => {}).then(async () => {
      const current = await readGlobal()
      const next = mutator(structuredClone(current))
      globalCache = await writeGlobal(next)
      return globalCache
    })
    globalQueue = currentTask
    return await currentTask
  }
  const ANCHOR_CATEGORY = '锚点'
  const BRANCH_CATEGORY = '支线'
  const MAX_AUTO_ENTRIES = 40
  const MAX_ENTRIES_TOTAL = 80

  function normalizeMembers(family) {
    return (Array.isArray(family?.members) ? family.members : []).map(item => typeof item === 'string'
      ? { gameId: item, alias: '' }
      : { gameId: String(item?.gameId || ''), alias: cleanText(item?.alias, 40) }).filter(item => item.gameId)
  }
  function familyOf(shared, gameId) {
    return (shared.families || []).find(family => normalizeMembers(family).some(item => item.gameId === gameId)) || null
  }
  function familyMembers(shared, gameId) {
    const family = familyOf(shared, gameId)
    return family ? normalizeMembers(family) : []
  }

  /** 本局结算产物 → 可编辑的临时世界书条目（原版：情报 / LTM 自动转条目）。 */
  function anchorSourceEntries(state) {
    const rows = []
    for (const fact of (state?.knownFacts || []).slice(-MAX_AUTO_ENTRIES)) {
      const title = cleanText(fact.title, 80), content = cleanText(fact.summary, 2200)
      if (!title || !content) continue
      rows.push({ id: String(fact.id || stableFactId(fact.title)), title: `【情报】${title}`, content, keys: cleanKeys(fact.keys), category: ANCHOR_CATEGORY })
    }
    for (const node of memoryRoots(state).slice(-ROOT_LIMIT)) {
      const content = cleanText(node.summary, 2200)
      if (!content) continue
      rows.push({ id: `ltm-${node.id}`, title: `【长期记忆】${cleanText(node.title, 80)}`, content, keys: cleanKeys(node.keys), category: ANCHOR_CATEGORY })
    }
    return rows
  }

  /** 同族其他成员的锚点条目 → 本局的【别名】支线条目（原版：族内 LTM / 情报互流）。 */
  async function branchSourceEntries(gameId, members) {
    const rows = []
    for (const member of (members || []).filter(item => item.gameId && item.gameId !== gameId)) {
      const data = await api.readGameData({ gameId: member.gameId }).catch(() => null)
      const prefix = member.alias ? `【${cleanText(member.alias, 40)}】` : '【支线】'
      for (const entry of (data?.worldbook?.entries || []).filter(item => item.auto === true && item.category === ANCHOR_CATEGORY).slice(-MAX_AUTO_ENTRIES)) {
        rows.push({ id: `branch-${member.gameId}-${entry.id}`,
          title: prefix + cleanText(String(entry.title || '').replace(/^【[^】]*】/, ''), 80),
          content: cleanText(entry.content, 2200), keys: cleanKeys(entry.keys), category: BRANCH_CATEGORY })
      }
    }
    return rows
  }

  /** 生成 / 更新 / 退役自动条目；玩家对常驻·强制·启用·绑定的手动设置一律保留。 */
  function mergeAutoEntries(entries, wanted) {
    const list = Array.isArray(entries) ? entries.map(entry => ({ ...entry })) : []
    const want = new Map(wanted.map(row => [row.id, row]))
    const out = []
    for (const entry of list) {
      if (entry.auto !== true) { out.push(entry); continue }
      const row = want.get(entry.id)
      if (!row) continue
      want.delete(entry.id)
      // 玩家改过关键词就保留玩家的（用上次生成值判断是否被改过），否则跟随源更新。
      const generated = Array.isArray(entry.autoKeys) ? entry.autoKeys : null
      const edited = generated ? JSON.stringify(entry.keys || []) !== JSON.stringify(generated) : false
      out.push({ ...entry, title: row.title, content: row.content, keys: edited ? entry.keys : row.keys,
        autoKeys: row.keys, category: row.category, auto: true, updatedAt: Date.now() })
    }
    let room = Math.max(0, MAX_ENTRIES_TOTAL - out.filter(entry => entry.auto !== true).length - want.size)
    for (const row of want.values()) {
      if (room-- <= 0) break
      out.push({ ...row, keys: row.keys, autoKeys: row.keys, secondaryKeys: [], constant: false, force: false,
        enabled: true, bound: true, auto: true, updatedAt: Date.now() })
    }
    return out.slice(-MAX_ENTRIES_TOTAL)
  }

  /** 重算本局自动条目（锚点 + 支线）并写回。 */
  async function refreshAutoEntries(gameId, state) {
    const shared = await sharedValue()
    const wanted = [...anchorSourceEntries(state), ...await branchSourceEntries(gameId, familyMembers(shared, gameId))]
    return await writePluginData(gameId, current => ({ ...current,
      worldbook: { ...current.worldbook, entries: mergeAutoEntries(current.worldbook?.entries, wanted) } }))
  }

  function normalizeWorldbookEntry(raw, index = 0) {
    raw = object(raw)
    const title = cleanText(raw.title, 120)
    const content = cleanText(raw.content, 2200)
    const sourceId = cleanText(raw.id, 64) || title || `row-${index + 1}`
    const id = /^[A-Za-z0-9._-]{1,64}$/.test(sourceId) ? sourceId : `entry-${stableFactId(sourceId)}`
    if (!title) throw new Error('世界书条目标题不能为空')
    if (!content) throw new Error('世界书条目内容不能为空')
    return { id, title, keys: cleanKeys(raw.keys), secondaryKeys: cleanKeys(raw.secondaryKeys), content,
      constant: raw.constant === true, force: raw.force === true, enabled: raw.enabled !== false,
      bound: raw.bound !== false, category: cleanText(raw.category, 40), auto: raw.auto === true,
      autoKeys: cleanKeys(raw.autoKeys), updatedAt: Date.now() }
  }
  function cleanWorldbook(entries) {
    if (!Array.isArray(entries)) throw new Error('entries 必须是数组')
    if (entries.length > 80) throw new Error('单局临时世界书最多 80 条')
    const ids = new Set()
    return entries.map((entry, index) => {
      const normalized = normalizeWorldbookEntry(entry, index)
      if (ids.has(normalized.id)) throw new Error('条目 ID 重复：' + normalized.id)
      ids.add(normalized.id)
      return normalized
    })
  }
  api.handle('narrative-anchor-v2/get-state', async ({ gameId, turn }) => {
    const latest = Number(turn) || (await api.getTurnState({ gameId })).turn
    const plugin = await pluginData(gameId)
    if (!latest) return { state: null, turn: 0, textVersion: null, stateTurn: 0, config: plugin.config }
    const [saved, current] = await Promise.all([api.readTurnData({ gameId, turn: latest }), api.getTurn({ gameId, turn: latest })])
    return { state: saved?.data || null, turn: latest, textVersion: current?.textVersion || null, stateTurn: saved?.turn || 0, config: plugin.config }
  })
  api.handle('narrative-anchor-v2/save-state', async ({ gameId, turn, textVersion, data }) => {
    const state = object(data)
    const current = await api.getTurn({ gameId, turn })
    if (!current) throw new Error('当前轮次不可编辑或尚未结算')
    const expected = typeof textVersion === 'string' ? textVersion : current.textVersion
    const before = (await api.readTurnData({ gameId, turn }))?.data || emptyState()
    const next = fitState({ ...before, ...state, updatedAt: Date.now() })
    await api.saveTurnData({ gameId, turn, textVersion: expected, data: next })
    return { ok: true, turn, textVersion: expected }
  })
  api.handle('narrative-anchor-v2/save-config', async ({ gameId, maxStm, injectPosition }) => {
    const value = Number(maxStm)
    if (!Number.isFinite(value) || value < 1 || value > 50) throw new Error('STM 保留条数须为 1–50')
    // 注入位置：'before' = Tavern 自己的上下文/写作规则之前（原版默认）；'after' = 之后。
    const position = injectPosition === undefined ? undefined : (injectPosition === 'after' ? 'after' : 'before')
    const saved = await writePluginData(gameId, current => ({ ...current,
      config: { ...current.config, maxStm: Math.floor(value), ...(position ? { injectPosition: position } : {}) } }))
    return { ok: true, config: saved.config }
  })
  api.handle('narrative-anchor-v2/get-worldbook', async ({ gameId }) => {
    const data = await pluginData(gameId)
    return { entries: data.worldbook.entries || [] }
  })
  api.handle('narrative-anchor-v2/save-worldbook', async ({ gameId, entries }) => {
    const normalized = cleanWorldbook(entries)
    const saved = await writePluginData(gameId, current => ({ ...current, worldbook: { ...object(current.worldbook), entries: normalized } }))
    return { ok: true, count: saved.worldbook.entries.length }
  })
  api.handle('narrative-anchor-v2/delete-worldbook-entries', async ({ gameId, ids }) => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('ids 必须是字符串数组')
    const remove = new Set(ids)
    const saved = await writePluginData(gameId, current => ({ ...current,
      worldbook: { ...current.worldbook, entries: (current.worldbook.entries || []).filter(entry => !remove.has(entry.id)) } }))
    return { ok: true, count: saved.worldbook.entries.length }
  })
  api.handle('narrative-anchor-v2/export-worldbook', async ({ gameId, ids }) => {
    const data = await pluginData(gameId)
    const selected = Array.isArray(ids) && ids.length ? new Set(ids) : null
    return { filename: 'narrative-anchor-worldbook.json', text: JSON.stringify({ version: 1,
      entries: (data.worldbook.entries || []).filter(entry => !selected || selected.has(entry.id)) }, null, 2) }
  })
  api.handle('narrative-anchor-v2/list-shared-books', async ({ gameId }) => {
    const sharedData = await sharedValue()
    const shared = sharedData.worldbooks || []
    const local = await pluginData(gameId)
    const family = familyOf(sharedData, gameId)
    const families = family ? [{ id: family.id, members: normalizeMembers(family), self: gameId }] : []
    return { books: shared.map(book => ({ ...book, bound: book.autoBind === true || (local.worldbook.boundSharedIds || []).includes(book.id),
      excluded: (local.worldbook.disabledGlobalIds || []).includes(book.id) })), families }
  })
  api.handle('narrative-anchor-v2/bind-local-worldbook', async ({ gameId, id, bound }) => {
    const entryId = cleanText(id, 64)
    const saved = await writePluginData(gameId, current => {
      const worldbook = { entries: [], ...object(current.worldbook) }
      worldbook.entries = (worldbook.entries || []).map(entry => entry.id === entryId ? { ...entry, bound: bound === true } : entry)
      return { ...current, worldbook }
    })
    return { ok: true, entries: saved.worldbook.entries }
  })
  api.handle('narrative-anchor-v2/save-shared-book', async ({ id, title, entries, autoBind }) => {
    const bookId = cleanText(id, 48).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    const bookTitle = cleanText(title, 80)
    if (!bookId || !bookTitle) throw new Error('全局书需要有效 ID 和标题')
    const normalized = cleanWorldbook(entries).slice(0, 80)
    const saved = await updateShared(current => {
      const books = current.worldbooks.filter(book => book.id !== bookId)
      books.push({ id: bookId, title: bookTitle, entries: normalized, autoBind: autoBind === true })
      return { ...current, worldbooks: books.slice(-20) }
    })
    return { ok: true, books: saved.worldbooks }
  })
  api.handle('narrative-anchor-v2/delete-shared-book', async ({ id }) => {
    const bookId = cleanText(id, 48)
    await updateShared(current => ({ ...current, worldbooks: current.worldbooks.filter(book => book.id !== bookId) }))
    return { ok: true }
  })
  api.handle('narrative-anchor-v2/bind-shared-book', async ({ gameId, id, bound, excludeGlobal }) => {
    const bookId = cleanText(id, 48)
    const saved = await writePluginData(gameId, current => {
      const worldbook = { entries: [], ...object(current.worldbook) }
      const boundIds = new Set(Array.isArray(worldbook.boundSharedIds) ? worldbook.boundSharedIds : [])
      const excludedIds = new Set(Array.isArray(worldbook.disabledGlobalIds) ? worldbook.disabledGlobalIds : [])
      if (bound === true) boundIds.add(bookId); else boundIds.delete(bookId)
      if (excludeGlobal === true) excludedIds.add(bookId); else if (excludeGlobal === false) excludedIds.delete(bookId)
      return { ...current, worldbook: { ...worldbook, boundSharedIds: [...boundIds], disabledGlobalIds: [...excludedIds] } }
    })
    return { ok: true, worldbook: saved.worldbook }
  })

  // ---- 支线族谱管理（原版：改名 / 别名 / 解除关联 / 并族 / 手动同步；建支线仍走 Tavern 原生 fork） ----
  async function refreshMemberEntries(gameId) {
    if (!gameId) return
    try {
      const latest = (await api.getTurnState({ gameId })).turn
      const state = latest ? (await api.readTurnData({ gameId, turn: latest }))?.data || null : null
      await refreshAutoEntries(gameId, state)
    } catch (error) { logger.warn?.('[Narrative Anchor] 支线条目刷新失败：' + String(error?.message || error)) }
  }

  api.handle('narrative-anchor-v2/rename-member', async ({ gameId, targetGameId, alias }) => {
    const target = cleanText(targetGameId, 64) || cleanText(gameId, 64)
    if (!target) throw new Error('缺少要改名的局')
    const name = cleanText(alias, 40)
    const saved = await updateShared(current => {
      const families = (current.families || []).map(family => ({ ...family, members: normalizeMembers(family) }))
      const family = families.find(item => item.members.some(member => member.gameId === target))
      if (!family) throw new Error('这一局还没有支线族谱；请先用 Tavern 原生功能创建支线')
      family.members = family.members.map(member => (member.gameId === target ? { ...member, alias: name } : member))
      return { ...current, families }
    })
    const family = familyOf(saved, target)
    for (const member of (family ? normalizeMembers(family) : [])) await refreshMemberEntries(member.gameId)
    return { ok: true, family: family ? { id: family.id, members: normalizeMembers(family) } : null }
  })

  api.handle('narrative-anchor-v2/unlink-member', async ({ gameId, targetGameId }) => {
    const target = cleanText(targetGameId, 64) || cleanText(gameId, 64)
    if (!target) throw new Error('缺少要解除关联的局')
    const previous = familyOf(await sharedValue(), target)
    const saved = await updateShared(current => {
      const families = (current.families || []).map(family => ({ ...family, members: normalizeMembers(family) }))
        .map(family => ({ ...family, members: family.members.filter(member => member.gameId !== target) }))
        .filter(family => family.members.length > 1)
      return { ...current, families }
    })
    await refreshMemberEntries(target)
    for (const member of normalizeMembers(previous)) if (member.gameId !== target) await refreshMemberEntries(member.gameId)
    return { ok: true, families: (saved.families || []).map(family => ({ id: family.id, members: normalizeMembers(family) })) }
  })

  api.handle('narrative-anchor-v2/merge-families', async ({ gameId, fromFamilyId, intoFamilyId }) => {
    const from = cleanText(fromFamilyId, 64), into = cleanText(intoFamilyId, 64)
    const before = await sharedValue()
    const source = (before.families || []).find(family => family.id === from)
    if (!source) throw new Error('找不到要并入的族谱')
    const target = into ? (before.families || []).find(family => family.id === into) : familyOf(before, gameId)
    if (!target) throw new Error('找不到要并入的目标族谱')
    if (target.id === source.id) throw new Error('不能并入自己')
    const merged = [...normalizeMembers(target)]
    for (const member of normalizeMembers(source)) if (!merged.some(item => item.gameId === member.gameId)) merged.push(member)
    const saved = await updateShared(current => {
      const families = (current.families || []).map(family => ({ ...family, members: normalizeMembers(family) }))
        .filter(family => family.id !== source.id)
        .map(family => (family.id === target.id ? { ...family, members: merged } : family))
      return { ...current, families }
    })
    for (const member of merged) await refreshMemberEntries(member.gameId)
    return { ok: true, families: (saved.families || []).map(family => ({ id: family.id, members: normalizeMembers(family) })) }
  })

  api.handle('narrative-anchor-v2/sync-family', async ({ gameId }) => {
    await refreshMemberEntries(gameId)
    const family = familyOf(await sharedValue(), gameId)
    return { ok: true, family: family ? { id: family.id, members: normalizeMembers(family) } : null }
  })

  api.handle('narrative-anchor-v2/rebuild-entries', async ({ gameId, turn }) => {
    const latest = Number(turn) || (await api.getTurnState({ gameId })).turn
    const state = latest ? (await api.readTurnData({ gameId, turn: latest }))?.data || null : null
    const saved = await refreshAutoEntries(gameId, state)
    return { ok: true, count: (saved.worldbook.entries || []).length }
  })

  // ---- 标签与状态标记（原版：锚点 / 支线 / 人工 / 强制注入 / 在上下文 / 已停用 / 关键词命中） ----
  api.handle('narrative-anchor-v2/list-entries', async ({ gameId, turn }) => {
    const data = await pluginData(gameId)
    const latest = Number(turn) || (await api.getTurnState({ gameId })).turn
    const state = latest ? (await api.readTurnData({ gameId, turn: latest }))?.data || null : null
    const text = cleanText(state?.lastTurnText, 20000)
    const entries = (data.worldbook.entries || []).map(entry => ({ ...entry, flags: {
      anchor: entry.category === ANCHOR_CATEGORY,
      branch: entry.category === BRANCH_CATEGORY,
      manual: entry.auto !== true,
      constant: entry.constant === true,
      force: entry.force === true,
      inContext: entry.constant === true || entry.force === true,
      disabled: entry.enabled === false,
      hit: entry.enabled !== false && !!text && (entry.keys || []).some(key => key && text.includes(key)),
    } }))
    const shared = await sharedValue()
    const family = familyOf(shared, gameId)
    return { entries,
      family: family ? { id: family.id, members: normalizeMembers(family) } : null,
      families: (shared.families || []).map(item => ({ id: item.id, members: normalizeMembers(item) })) }
  })

  api.onTimelineChanged(async change => {
    if (change.kind !== 'fork' || !change.fromGameId || !change.gameId) return
    await updateShared(current => {
      const families = Array.isArray(current.families)
        ? current.families.map(family => ({ ...family, members: normalizeMembers(family) })) : []
      let family = families.find(item => item.members.some(member => member.gameId === change.fromGameId))
      if (!family) { family = { id: 'family-' + stableFactId(change.fromGameId), members: [{ gameId: change.fromGameId, alias: '主线' }] }; families.push(family) }
      if (!family.members.some(member => member.gameId === change.gameId)) family.members.push({ gameId: change.gameId, alias: '' })
      return { ...current, families: families.slice(-200) }
    }).catch(error => logger.warn?.('[Narrative Anchor] 分支族谱同步失败：' + String(error?.message || error)))
    // 新建支线后立刻互流两侧条目，不必等手动同步。
    await refreshMemberEntries(change.gameId)
    await refreshMemberEntries(change.fromGameId)
  })

  api.settlementSection({
    name: 'narrative-anchor',
    text: '请在本轮官方结算工具完成前调用 narrative_anchor_submit，按本轮正文中已确认发生的事实增量提交叙事状态、剧情节点和必要的记忆。只提交变化；无变化可传空对象。不得替代 Tavern 的 MVU 或姿势工具。',
  })
  api.settlementTool({
    name: TOOL_NAME,
    description: '增量提交叙事锚点。只根据本轮已发生正文事实；状态字段只交变化字段，记忆按需提交。MVU 与姿势仍由 Tavern 原生工具处理。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        current_state: { type: 'object', additionalProperties: false, properties: {
          time: { type: 'string' }, world: { type: 'string' }, location: { type: 'string' },
          characters: { type: 'array', items: { type: 'string' } }, environment: { type: 'array', items: { type: 'string' } },
          items: { type: 'array', items: { type: 'string' } }, focus: { type: 'string' },
        } },
        plot_route: { type: 'object', additionalProperties: false, properties: {
          current_node: { type: 'string' }, recap: { type: 'string' }, next_scene: { type: 'string' },
          foreshadowing: { type: 'array', items: { type: 'string' } },
        } },
        memory: { type: 'object', additionalProperties: false, properties: {
          stm: { type: 'array', maxItems: 1, items: { type: 'object', additionalProperties: false, properties: {
            title: { type: 'string' }, summary: { type: 'string' },
          } } },
          ltm: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, properties: {
            title: { type: 'string' }, summary: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } },
          } } },
          known_facts: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, properties: {
            entry: { type: 'string' }, summary: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } },
          } } },
          foreshadowing: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, properties: {
            title: { type: 'string' }, detail: { type: 'string' }, status: { type: 'string', enum: ['open', 'closed'] },
            keywords: { type: 'array', items: { type: 'string' } },
          } } },
        } },
      },
    },
    async execute({ gameId, turn, arguments: args }) {
      const old = (await api.readTurnData({ gameId, turn }))?.data || null
      const state = fitState(mergeState(old, args, { turn, text: '', maxStm: old?.maxStm }))
      await api.saveTurnData({ gameId, turn, data: state })
      try { await refreshAutoEntries(gameId, state) }
      catch (error) { logger.warn?.('[Narrative Anchor] 锚点条目同步失败：' + String(error?.message || error)) }
      return { ok: true, turn, counts: { stm: state.stm.length, ltm: state.ltm.length, knownFacts: state.knownFacts.length, memoryRoots: memoryRoots(state).length } }
    },
  })

  // 注入位置每局可切换：注册 before / after 两个段落，只让生效的那个返回文本
  //（plugin-api 的 collectSections 会跳过空文本），因此不必重启即可切换。
  async function anchorTurnText({ gameId, turn }, mode) {
    let data
    try { data = await pluginData(gameId) } catch { data = emptyPluginData() }
    const position = data.config?.injectPosition === 'after' ? 'after' : 'before'
    if (position !== mode) return ''
    const saved = turn ? await api.readTurnData({ gameId, turn }).catch(() => null) : null
    return statePrompt(saved?.data)
  }
  api.turnSection({ name: 'narrative-anchor', position: 'before', text: context => anchorTurnText(context, 'before') })
  api.turnSection({ name: 'narrative-anchor-after', position: 'after', text: context => anchorTurnText(context, 'after') })

  api.worldbookEntries({ name: 'narrative-anchor-memory', entries: async ({ gameId, turn }) => {
    let gameData
    try { gameData = await pluginData(gameId) } catch { return [] }
    const saved = turn ? await api.readTurnData({ gameId, turn }).catch(() => null) : null
    const state = saved?.data
    const entries = gameData.worldbook.entries || []
    const localRows = entries.filter(entry => entry.enabled !== false && entry.bound !== false).map(entry => ({
      id: `local-${entry.id}`, title: entry.title, keys: entry.keys, secondaryKeys: entry.secondaryKeys,
      content: entry.content, constant: entry.constant === true, force: entry.force === true,
    }))
    const bound = new Set(gameData.worldbook.boundSharedIds || [])
    const excluded = new Set(gameData.worldbook.disabledGlobalIds || [])
    const global = sharedSnapshot()
    const globals = (global.worldbooks || []).filter(book => !excluded.has(book.id) && (book.autoBind === true || bound.has(book.id)))
    const globalRows = globals.flatMap(book => (book.entries || []).filter(entry => entry.enabled !== false && entry.bound !== false).map(entry => ({
      id: `global-${book.id}-${entry.id}`, title: entry.title || book.title, keys: entry.keys, secondaryKeys: entry.secondaryKeys,
      content: entry.content, constant: entry.constant === true, force: entry.force === true,
    })))
    // 已落成真条目的记忆不再动态合成（避免与 local-* 重复）；尚无落盘条目的旧局仍走这条兜底路径。
    // 支线互流同理走真条目（category=支线），所以这里不再合成 family-* 行。
    const materialized = new Set(entries.map(entry => entry.id))
    const memoryRows = state ? [
      ...(state.knownFacts || []).filter(row => !materialized.has(String(row.id || stableFactId(row.title))))
        .map(row => ({ id: `fact-${row.id}`, title: row.title, keys: row.keys, content: row.summary })),
      ...memoryRoots(state).filter(node => !materialized.has(`ltm-${node.id}`))
        .map(node => ({ id: `ltm-${node.id}`, title: node.title, keys: node.keys, content: node.summary })),
    ] : []
    return [...localRows, ...globalRows, ...memoryRows].slice(-MAX_ITEMS).map(row => ({ ...row, force: row.force === true }))
  } })

  api.compactionSection({ name: 'narrative-anchor', text: [
    '以下是本次摘要必须额外保住的内容（原文里出现过就不要丢）：',
    '- 因果链：谁因为什么做了什么、结果如何；悬而未决的因果不要写成已解决。',
    '- 人物与关系的变化：出场人物、身份/能力/状态的改动、关系的推进或破裂、未说出口的秘密与承诺。',
    '- 世界规则与设定：地点、组织、能力体系、经济与政治规则；只留仍然生效的规则，不要抄录描写。',
    '- 关键时间/地点/物品：专名、数字、称谓、持有者与所在位置。',
    '- 未兑现的伏笔与承诺：尚未回收的线索与约定都要留；已兑现的只留结果，篇幅不足时优先删已兑现的。',
    '- 用户意志：用户明确表达过的偏好、底线与对剧情的纠正；用户表述的事实永远有效。',
    '取舍优先级（冲突时按此顺序保留）：用户意志 > 人物关系 > 未兑现伏笔 > 当前生效设定 > 历史事件细节 > 当前现场；结果 > 过程；结构关系 > 场景叙述；长期影响 > 短期事态。',
    '篇幅硬约束：摘要全文控制在 4000 token 以内；宁可压缩已兑现伏笔与过期细节，也不要超限。',
    '只总结已发生的内容，不续写、不猜测、不评价；已有摘要要一并归纳、合并重复，使摘要显著短于原文。',
    '叙事锚点只是辅助记忆：与正文或人物卡设定冲突时以正文和人物卡为准；锚点里没有的内容不要凭它编造。',
  ].join('\n') })

  api.handle('narrative-anchor-v2/backfill', async ({ gameId, from, to }) => {
    const first = Number(from), last = Number(to)
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first) throw new Error('请输入有效的起止轮次')
    if (last - first + 1 > 25) throw new Error('单次最多回填 25 轮；请分段执行')
    const rows = await api.getHistory({ gameId, from: first, to: last })
    if (!rows.length) throw new Error('指定范围内没有可回填的已完成轮次')
    if (rows.length > 25) throw new Error('读取结果超过安全上限，请缩小范围')
    const transcript = rows.map(row => `【第 ${row.turn} 轮】\n玩家：${cleanText(row.input, 2500)}\n正文：${cleanText(row.text, 5000)}`).join('\n\n')
    if (transcript.length > 95000) throw new Error('所选历史总长度超过 95,000 字，请缩小范围后重试')
    const anchorTurn = await api.getTurn({ gameId, turn: last })
    if (!anchorTurn) throw new Error('所选结尾轮次不存在或尚未结算')
    const anchorVersion = anchorTurn.textVersion
    const state = (await api.readTurnData({ gameId, turn: last }))?.data || null
    const maxStm = Math.max(1, Math.min(50, Number(state?.maxStm) || 7))
    const tool = {
      name: 'narrative_anchor_backfill_submit',
      description: '提交所选历史范围的叙事锚点状态。只总结输入记录中真实发生的内容；每轮至多一条 STM，长期事实可合并为少量 LTM 与 known_facts。不得编造或把玩家意图当已发生事实。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          current_state: { type: 'object', additionalProperties: false, properties: {
            time: { type: 'string' }, world: { type: 'string' }, location: { type: 'string' },
            characters: { type: 'array', items: { type: 'string' } }, environment: { type: 'array', items: { type: 'string' } },
            items: { type: 'array', items: { type: 'string' } }, focus: { type: 'string' },
          } },
          plot_route: { type: 'object', additionalProperties: false, properties: {
            current_node: { type: 'string' }, recap: { type: 'string' }, next_scene: { type: 'string' },
            foreshadowing: { type: 'array', items: { type: 'string' } },
          } },
          memory: { type: 'object', additionalProperties: false, properties: {
            stm: { type: 'array', maxItems: 25, items: { type: 'object', additionalProperties: false, properties: { turn: { type: 'integer' }, title: { type: 'string' }, summary: { type: 'string' } } } },
            ltm: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, summary: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } } } } },
            known_facts: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false, properties: { entry: { type: 'string' }, summary: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } } } } },
            foreshadowing: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, detail: { type: 'string' }, status: { type: 'string', enum: ['open', 'closed'] }, keywords: { type: 'array', items: { type: 'string' } } } } },
          } },
        },
      },
      execute: async () => { throw new Error('回填工具必须通过 runTask 提交') },
    }
    let submission = null
    const prompt = [
      '你正在为一局已有剧情做一次性历史回填。只依据以下已完成的玩家输入和正文，不调用任何外部工具，不续写剧情。',
      `范围：第 ${first} 至第 ${last} 轮；读取到 ${rows.length} 轮。`,
      `请提交每轮最多一条客观 STM（turn 字段用原轮次号，建议不超过 ${maxStm} 条保留在近期状态；可按重要性省略重复/琐碎回合），当前状态只填有证据的字段，长期有价值事实放入 LTM/known_facts。`,
      '只调用 narrative_anchor_backfill_submit 一次；若范围里没有足够证据，提交空对象。',
      '【历史记录】', transcript,
    ].join('\n\n')
    await api.runTask({
      gameId, prompt, tools: [{ ...tool, execute: async args => { submission = object(args); return { ok: true } } }],
    })
    if (!submission) throw new Error('回填模型没有调用提交工具，未保存任何内容')
    const latest = await api.getTurn({ gameId, turn: last })
    if (!latest || latest.textVersion !== anchorVersion) throw new Error('回填期间所选正文版本已变化，结果未写入；请重新读取后再试')
    const merged = fitState(mergeState(state, submission, {
      turn: last, text: '', maxStm,
      maxStmRows: 25, maxLtmRows: 12, maxFactRows: 50,
    }))
    if (Array.isArray(submission.memory?.stm)) {
      const recovered = submission.memory.stm.map(row => {
        row = object(row)
        const rowTurn = Number(row.turn)
        if (!Number.isSafeInteger(rowTurn) || rowTurn < first || rowTurn > last) return null
        const summary = cleanText(row.summary)
        if (!summary) return null
        return { turn: rowTurn, title: cleanText(row.title, MAX_TITLE) || `第 ${rowTurn} 轮`, summary }
      }).filter(Boolean)
      if (recovered.length) {
        const byTurn = new Map((state?.backfilledStm || []).map(row => [Number(row.turn), row]))
        for (const row of recovered) byTurn.set(row.turn, row)
        merged.backfilledStm = [...byTurn.values()].sort((a, b) => Number(a.turn) - Number(b.turn)).slice(-MAX_STM)
      }
    }
    merged.backfilled = { from: first, to: last, turnsRead: rows.length, at: Date.now() }
    await api.saveTurnData({ gameId, turn: last, textVersion: latest.textVersion, data: merged })
    try { await refreshAutoEntries(gameId, merged) }
    catch (error) { logger.warn?.('[Narrative Anchor] 锚点条目同步失败：' + String(error?.message || error)) }
    return { ok: true, from: first, to: last, turnsRead: rows.length,
      counts: { stm: merged.stm.length, ltm: merged.ltm.length, knownFacts: merged.knownFacts.length, memoryRoots: memoryRoots(merged).length } }
  })
}
