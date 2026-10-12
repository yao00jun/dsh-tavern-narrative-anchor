/**
 * 叙事锚定系统 —— 核心存储与多级记忆状态树（v1.0 标准版）
 *
 * 核心机制：
 * - STM (Short-Term Memory): 轮次记忆客观累积，不主动清空，每条带 turn / title / summary
 * - LTM (Long-Term Memory): 树形层级压缩结构
 *   - 每 7 条未合并 STM 聚合成 depth=1 叶节点
 *   - 每 5 个同层级根节点递归聚合成更高深度节点 (depth=2, 3...)
 * - Focus (叙事备忘): 关键备忘追踪与自适应字数度量截断
 * - Known Facts: 动态长期客观事实，直接映射世界书候选召回池
 */

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function title12(value) {
  return str(value).replace(/\s+/g, ' ').trim().slice(0, 12)
}

function arrField(value) {
  if (value == null) return []
  let s = value
  if (typeof s === 'object') s = Object.values(s).map(x => (x != null && typeof x === 'object') ? '' : str(x)).filter(Boolean).join('，')
  if (!Array.isArray(s)) s = str(s).split(/[、，,;；\n]+/)
  return s.map(x => str(x).trim()).filter(Boolean)
}

function text(value) {
  if (value !== null && typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return str(value)
}

function object(value) {
  if (value === null || value === undefined) return {}
  return typeof value === 'object' ? value : {}
}

const FOCUS_TOKEN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[A-Za-z0-9]+(?:[.\-/:][A-Za-z0-9]+)*/gu

export function focusUnitCount(value) {
  const s = text(value)
  const m = s.match(FOCUS_TOKEN_RE)
  return m ? m.length : 0
}

export function truncateFocusDetail(value) {
  const s = text(value).trim()
  if (!s) return { value: '', full: '', truncated: false }
  const limit = 120 + Math.floor(Math.random() * 31) // 120–150 随机缓冲
  const ends = []
  for (const m of s.matchAll(FOCUS_TOKEN_RE)) ends.push(m.index + m[0].length)
  if (ends.length <= limit) return { value: s, full: s, truncated: false }
  return { value: s.slice(0, ends[limit - 1]).trim(), full: s, truncated: true }
}

export function createEmptyAnchor() {
  return {
    plot_route: { current_node: '', recap: '', next_scene: '', foreshadowing: [] },
    current_state: { time: '', world: '', location: '', characters: [], environment: [], items: [], focus: '', focus_full: '' },
    memory: {
      stm: [],
      ltm_tree: { nodes: {}, roots: [], next_id: 1 },
      ltm_snapshot: { content: '', turn: 0 },
      known_facts: [],
      foreshadow_library: []
    },
    meta: { turn_count: 0, created_at: Date.now(), settings: { enabled: true, maxSTMLength: 7 } }
  }
}

export function loadAnchor(anchorOrChat) {
  if (!anchorOrChat || typeof anchorOrChat !== 'object') {
    return createEmptyAnchor()
  }
  const a = anchorOrChat.narrativeAnchor && typeof anchorOrChat.narrativeAnchor === 'object'
    ? anchorOrChat.narrativeAnchor
    : anchorOrChat

  if (!a.memory || typeof a.memory !== 'object') a.memory = {}
  if (!Array.isArray(a.memory.stm)) a.memory.stm = []
  if (!Array.isArray(a.memory.known_facts)) a.memory.known_facts = []
  if (!Array.isArray(a.memory.foreshadow_library)) a.memory.foreshadow_library = []

  if (!a.memory.ltm_tree || typeof a.memory.ltm_tree !== 'object') {
    a.memory.ltm_tree = { nodes: {}, roots: [], next_id: 1 }
  }
  if (!a.memory.ltm_snapshot || typeof a.memory.ltm_snapshot !== 'object') {
    a.memory.ltm_snapshot = { content: '', turn: 0 }
  }
  if (!a.meta || typeof a.meta !== 'object') a.meta = { turn_count: 0, created_at: Date.now() }
  if (!a.meta.settings || typeof a.meta.settings !== 'object') a.meta.settings = { enabled: true, maxSTMLength: 7 }
  if (!a.plot_route || typeof a.plot_route !== 'object') {
    a.plot_route = { current_node: '', recap: '', next_scene: '', foreshadowing: [] }
  }
  if (!a.current_state || typeof a.current_state !== 'object') {
    a.current_state = { time: '', world: '', location: '', characters: [], environment: [], items: [], focus: '', focus_full: '' }
  }
  return a
}

export function getUnmergedStmCount(anchor) {
  const stm = anchor.memory?.stm || []
  return stm.filter((e) => e.merged_into == null).length
}

export function createLeafLtm(anchor, summary, stmCount = 7, keywords = [], title = '') {
  const tree = anchor.memory.ltm_tree
  const stm = anchor.memory.stm
  const unmergedIndices = []
  for (let i = 0; i < stm.length && unmergedIndices.length < stmCount; i++) {
    if (stm[i].merged_into == null) unmergedIndices.push(i)
  }
  if (unmergedIndices.length === 0) return null

  const id = tree.next_id++
  const node = {
    id,
    depth: 1,
    title: title12(title) || title12(summary),
    summary: str(summary),
    keywords: Array.isArray(keywords) ? keywords.filter(Boolean).map(str) : [],
    children: [],
    stm_range: [unmergedIndices[0], unmergedIndices[unmergedIndices.length - 1]],
    created_at: Date.now(),
    turn: anchor.meta.turn_count || 0
  }
  tree.nodes[id] = node
  tree.roots.push(id)
  for (const idx of unmergedIndices) {
    stm[idx].merged_into = id
  }
  enforceRootLimit(tree)
  sortRootsInPlace(tree)
  updateLtmSnapshot(anchor)
  return node
}

export function mergeLtmNodes(anchor, depth, summary, count = 5, keywords = [], title = '') {
  const tree = anchor.memory.ltm_tree
  const depthRoots = tree.roots
    .filter((id) => tree.nodes[id]?.depth === depth)
    .sort((a, b) => (tree.nodes[a].created_at || 0) - (tree.nodes[b].created_at || 0))
    .slice(0, count)
  if (depthRoots.length === 0) return null

  const id = tree.next_id++
  const node = {
    id,
    depth: depth + 1,
    title: title12(title) || title12(summary),
    summary: str(summary),
    keywords: Array.isArray(keywords) ? keywords.filter(Boolean).map(str) : [],
    children: depthRoots,
    stm_range: null,
    created_at: Date.now(),
    turn: anchor.meta.turn_count || 0
  }
  tree.nodes[id] = node
  tree.roots = tree.roots.filter((rid) => !depthRoots.includes(rid))
  tree.roots.push(id)
  enforceRootLimit(tree)
  sortRootsInPlace(tree)
  updateLtmSnapshot(anchor)
  return node
}

function sortRootsInPlace(tree) {
  tree.roots = sortRootsChronologically(tree)
}

function enforceRootLimit(tree) {
  const MAX_ROOTS = 15
  if (tree.roots.length <= MAX_ROOTS) return
  const deepRoots = tree.roots.filter((id) => tree.nodes[id]?.depth > 2)
  if (deepRoots.length < 2) return
  const id = tree.next_id++
  const summaries = deepRoots.map((rid) => tree.nodes[rid].summary).filter(Boolean)
  const node = {
    id,
    depth: Math.max(...deepRoots.map((rid) => tree.nodes[rid].depth)) + 1,
    title: '兜底合并',
    summary: '【程序合并·根节点超限兜底】' + summaries.join('；'),
    children: deepRoots,
    stm_range: null,
    created_at: Date.now(),
    turn: 0,
    auto_merged: true
  }
  tree.nodes[id] = node
  tree.roots = tree.roots.filter((rid) => !deepRoots.includes(rid))
  tree.roots.push(id)
  sortRootsInPlace(tree)
}

function nodeHistoryStart(tree, id, memo = new Map()) {
  const node = tree.nodes[id]
  if (!node) return Infinity
  if (memo.has(id)) return memo.get(id)
  let start = Infinity
  if (Array.isArray(node.stm_range)) {
    const range0 = Number(node.stm_range[0])
    if (Number.isFinite(range0)) start = range0
  }
  if (start === Infinity) {
    for (const cid of node.children || []) {
      const s = nodeHistoryStart(tree, cid, memo)
      if (s < start) start = s
    }
  }
  memo.set(id, start)
  return start
}

function sortRootsChronologically(tree) {
  return [...tree.roots].sort((a, b) => {
    const ha = nodeHistoryStart(tree, a)
    const hb = nodeHistoryStart(tree, b)
    if (ha !== hb) return ha - hb
    return (tree.nodes[a]?.created_at || 0) - (tree.nodes[b]?.created_at || 0)
  })
}

export function updateLtmSnapshot(anchor) {
  const tree = anchor.memory.ltm_tree
  if (!tree || tree.roots.length === 0) {
    anchor.memory.ltm_snapshot = { content: '', turn: anchor.meta.turn_count || 0 }
    return
  }
  const lines = []
  for (const rid of sortRootsChronologically(tree)) {
    const node = tree.nodes[rid]
    if (!node) continue
    const depthMark = node.depth > 1 ? `[L${node.depth}]` : '[L1]'
    lines.push(`${depthMark} ${node.summary}`)
  }
  const content = '【LTM 长期记忆快照】\n' + lines.join('\n')
  anchor.memory.ltm_snapshot = { content, turn: anchor.meta.turn_count || 0 }
}

export function formatLtmTree(anchor) {
  const tree = anchor.memory?.ltm_tree
  if (!tree || tree.roots.length === 0) return ''
  const lines = []
  for (const rid of sortRootsChronologically(tree)) {
    const node = tree.nodes[rid]
    if (!node) continue
    const depthMark = node.depth > 1 ? `[L${node.depth}]` : '[L1]'
    lines.push(`${depthMark} ${node.summary}`)
  }
  return lines.join('\n')
}

export function formatAnchorForInjection(anchor) {
  if (!anchor || typeof anchor !== 'object') return ''
  const sections = []
  const cs = anchor.current_state || {}
  const csParts = []
  if (cs.time) csParts.push(`时间: ${cs.time}`)
  if (cs.world) csParts.push(`世界: ${cs.world}`)
  if (cs.location) csParts.push(`地点: ${cs.location}`)
  if (Array.isArray(cs.characters) && cs.characters.length > 0) csParts.push(`在场人物: ${cs.characters.join(', ')}`)
  if (cs.environment) csParts.push('环境: ' + (Array.isArray(cs.environment) ? cs.environment.join('、') : cs.environment))
  if (Array.isArray(cs.items) && cs.items.length > 0) csParts.push(`物品: ${cs.items.join(', ')}`)
  if (cs.focus) csParts.push(`叙事备忘: ${cs.focus}`)
  if (csParts.length > 0) sections.push('【当前状态】\n' + csParts.join('\n'))

  if (sections.length === 0) return ''
  return sections.join('\n\n')
}

export function applyAnchorSubmission(anchorOrChat, submission, options = {}) {
  const anchor = loadAnchor(anchorOrChat)
  const data = object(submission)
  const turnNum = Number(options.turn) || anchor.meta.turn_count || 1

  if (object(data.current_state) && Object.keys(object(data.current_state)).length > 0) {
    const cs = object(data.current_state)
    const prev = anchor.current_state || {}
    const textField = (v, fallback) => (v === undefined ? fallback : text(v))
    const arrTextField = (v, fallback) => (v === undefined ? fallback : arrField(v))

    anchor.current_state = {
      time: textField(cs.time, str(prev.time)),
      world: textField(cs.world, str(prev.world)),
      location: textField(cs.location, str(prev.location)),
      characters: arrTextField(cs.characters, Array.isArray(prev.characters) ? prev.characters : []),
      environment: arrTextField(cs.environment, Array.isArray(prev.environment) ? prev.environment : []),
      items: arrTextField(cs.items, Array.isArray(prev.items) ? prev.items : []),
      ...(cs.focus === undefined
        ? { focus: prev.focus || '', focus_full: prev.focus_full || '' }
        : (() => {
            const det = truncateFocusDetail(cs.focus)
            return det.truncated
              ? { focus: det.value, focus_full: det.full }
              : { focus: det.value, focus_full: '' }
          })())
    }
  }

  if (object(data.memory) && Object.keys(object(data.memory)).length > 0) {
    const mem = object(data.memory)

    if (Array.isArray(mem.stm) && mem.stm.length > 0) {
      const cs = anchor.current_state || {}
      for (const entry of mem.stm) {
        anchor.memory.stm.push({
          id: Date.now() + Math.random(),
          turn: turnNum,
          message_id: '',
          time: str(cs.time),
          location: str(cs.location),
          title: title12(entry.title),
          summary: str(entry.summary),
          merged_into: null
        })
      }
    }

    if (mem.ltm_leaf && str(mem.ltm_leaf.summary)) {
      createLeafLtm(anchor, mem.ltm_leaf.summary, Number(mem.ltm_leaf.stm_count) || 7, mem.ltm_leaf.keywords || [], str(mem.ltm_leaf.title))
    }

    if (mem.ltm_merge && str(mem.ltm_merge.summary) && Number(mem.ltm_merge.depth) > 0) {
      mergeLtmNodes(anchor, Number(mem.ltm_merge.depth), mem.ltm_merge.summary, Number(mem.ltm_merge.count) || 5, mem.ltm_merge.keywords || [], str(mem.ltm_merge.title))
    }

    if (Array.isArray(mem.known_facts)) {
      for (const fact of mem.known_facts) {
        const existing = (fact.id
          ? anchor.memory.known_facts.findIndex((f) => f.id === fact.id)
          : -1) >= 0
          ? anchor.memory.known_facts.findIndex((f) => f.id === fact.id)
          : anchor.memory.known_facts.findIndex((f) => f.entry === fact.entry)
        const kw = Array.isArray(fact.keywords) ? fact.keywords.filter(Boolean).map(str) : []
        if (existing >= 0) {
          const old = anchor.memory.known_facts[existing]
          anchor.memory.known_facts.splice(existing, 1)
          const newSummary = str(fact.summary)
          const oldSummary = String(old.summary || '')
          if (newSummary && !oldSummary.includes(newSummary)) {
            const ts = Math.floor(Date.now() / 1000).toString(16)
            old.summary = oldSummary + '\n--' + ts + '--\n' + newSummary
          }
          if (kw.length > 0) old.keywords = kw
          anchor.memory.known_facts.push(old)
        } else {
          const kfId = fact.id || ('kf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6))
          anchor.memory.known_facts.push({ id: kfId, entry: str(fact.entry), summary: str(fact.summary), keywords: kw })
        }
      }
    }
  }

  anchor.meta.turn_count = Math.max(anchor.meta.turn_count || 0, turnNum)
  anchor.meta.updated_at = Date.now()
  return anchor
}

export function getAnchorStats(anchor) {
  if (!anchor || !anchor.memory) return { stm_count: 0, stm_unmerged: 0, ltm_root_count: 0, ltm_total_nodes: 0, known_facts_count: 0, turn_count: 0 }
  const stm = anchor.memory?.stm || []
  const tree = anchor.memory?.ltm_tree
  const rootCount = tree?.roots?.length || 0
  const totalNodes = tree ? Object.keys(tree.nodes).length : 0
  const unmergedStm = stm.filter((e) => e.merged_into == null).length
  return {
    stm_count: stm.length,
    stm_unmerged: unmergedStm,
    ltm_root_count: rootCount,
    ltm_total_nodes: totalNodes,
    known_facts_count: anchor.memory?.known_facts?.length || 0,
    turn_count: anchor.meta?.turn_count || 0
  }
}
