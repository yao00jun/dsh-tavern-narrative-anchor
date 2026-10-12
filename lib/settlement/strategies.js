/**
 * 叙事锚定系统 —— 工具定义与记忆检索策略（v1.0 标准版）
 */

import { formatLtmTree } from './store.js'

export const NARRATIVE_ANCHOR_READ_TOOL = Object.freeze({
  name: 'narrative_anchor_read',
  description: '检索叙事锚定记忆（STM短期记忆 / known_facts已知情报），用于回忆剧情细节。query 为关键词，多个关键词用空格分隔；返回匹配条目的摘要，不是完整锚点数据。每次结算最多调用 3 次。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1, description: '搜索关键词（人物/地点/事件/物品/关系），多个用空格分隔' },
      kind: { type: 'string', enum: ['all', 'stm', 'known_facts'], description: '搜索范围：all=全部（默认），stm=仅短期记忆，known_facts=仅已知情报' },
      limit: { type: 'integer', minimum: 1, maximum: 10, description: '最多返回多少条命中，默认 5' }
    },
    required: ['query']
  })
})

export const NARRATIVE_ANCHOR_SUBMIT_TOOL = Object.freeze({
  name: 'narrative_anchor_submit',
  description: [
    '提交叙事锚定数据',
    '规则：',
    '(1)当前状态按字段增量提交：只提交变化的字段，未提交的字段自动保留',
    '(2)记忆：',
    '  - stm 每轮恰好 1 条，永远累积不清空；time/location 由系统自动从 current_state 填充；',
    '  - 未合并 STM 达 7 条时，本轮必须同时提交 ltm_leaf；提交后这 7 条 STM 标记为已合并；',
    '  - LTM 树某深度根节点达 5 个时，本轮必须同时提交 ltm_merge；',
    '  - stm / ltm_leaf / ltm_merge 均必须携带 title：不超过 12 字的标题，概括该条内容核心；',
    '  - known_facts 同entry追加，功能为动态世界书；',
    '(3)只依据本轮正文已发生事实更新，不预测；',
    '(4)本轮无任何变化时提交空对象 {}。'
  ].join('\n'),
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      current_state: {
        type: 'object',
        additionalProperties: true,
        description: '当前状态，未提交字段自动保留',
        properties: {
          time: { type: 'string', description: '当前剧情时间' },
          world: { type: 'string', description: '世界/纪元/位面' },
          location: { type: 'string', description: '具体地点' },
          characters: { type: 'array', items: { type: 'string' }, description: '在场人物列表' },
          environment: { type: 'array', items: { type: 'string' }, description: '关键场景要素/环境名词数组（如 ["魔法阵","狂风"]）' },
          items: { type: 'array', items: { type: 'string' }, description: '关键物品名词数组' },
          focus: { type: 'string', description: '叙事备忘（100字内），记录长期暗线关键信息，无重大变化无需提交' }
        }
      },
      memory: {
        type: 'object',
        additionalProperties: false,
        description: '多级记忆系统',
        properties: {
          stm: {
            type: 'array',
            description: '本轮记忆（每轮仅 1 条）：概括剧情核心事件，永远累积',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                title: { type: 'string', description: '本条记忆标题（必填，不超过 12 字，概括核心事件）' },
                summary: { type: 'string', description: '本轮剧情概括与关键信息，客观无修饰' }
              },
              required: ['title', 'summary']
            }
          },
          ltm_leaf: {
            type: 'object',
            description: 'LTM 叶节点生成（未合并 STM 达到 7 条时提交）：提取关键信息并提炼为一条连贯摘要',
            properties: {
              title: { type: 'string', description: '本节点标题（不超过 12 字）' },
              summary: { type: 'string', description: '7 条 STM 合并后的关键信息摘要' },
              keywords: { type: 'array', items: { type: 'string' }, description: '3-6 个关键词，用于后续世界书召回触发' },
              stm_count: { type: 'number', description: '合并的 STM 数量，默认 7' }
            },
            required: ['title', 'summary', 'keywords']
          },
          ltm_merge: {
            type: 'object',
            description: 'LTM 中间节点合并（某深度根节点达到 5 个时提交）：合并为一个更高层节点',
            properties: {
              depth: { type: 'number', description: '要合并的深度（1=叶节点层，2=第二层...）' },
              title: { type: 'string', description: '合并后节点标题（不超过 12 字）' },
              summary: { type: 'string', description: '合并后的摘要' },
              keywords: { type: 'array', items: { type: 'string' }, description: '3-6 个关键词，覆盖合并范围内所有关键信息' },
              count: { type: 'number', description: '合并的节点数量，默认 5' }
            },
            required: ['depth', 'title', 'summary', 'keywords']
          },
          known_facts: {
            type: 'array',
            description: '长期客观已知事实（进入动态世界书），仅追加新确立的事实',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                entry: { type: 'string', description: '条目名/实体名' },
                summary: { type: 'string', description: '设定与情报内容' },
                keywords: { type: 'array', items: { type: 'string' }, description: '2-4 个关键词，用于世界书触发' }
              },
              required: ['entry', 'summary']
            }
          }
        }
      }
    }
  })
})

export function searchAnchorMemory(anchor, query, kind = 'all', limit = 5) {
  if (!anchor || typeof anchor !== 'object' || !query) return { results: [], total: 0 }
  const keywords = String(query).toLowerCase().split(/\s+/).filter(Boolean)
  if (keywords.length === 0) return { results: [], total: 0 }
  const results = []

  const entries = []
  if (kind === 'all' || kind === 'stm') {
    const stmList = Array.isArray(anchor.memory?.stm) ? anchor.memory.stm : []
    stmList.forEach((e, i) => {
      if (e && e.summary) entries.push({ kind: 'stm', index: i, text: ((e.time || '') + ' ' + (e.location || '') + ' ' + e.summary).toLowerCase(), e })
    })
  }
  if (kind === 'all' || kind === 'known_facts') {
    const kfList = Array.isArray(anchor.memory?.known_facts) ? anchor.memory.known_facts : []
    kfList.forEach((f, i) => {
      if (f && f.entry) entries.push({ kind: 'known_facts', index: i, text: (f.entry + ' ' + (f.summary || '')).toLowerCase(), f })
    })
  }

  const hasCJK = (s) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s)
  const bigrams = (s) => {
    const grams = []
    for (let i = 0; i + 2 <= s.length; i++) grams.push(s.slice(i, i + 2))
    return grams
  }

  const N = entries.length
  const idfOf = (kw) => {
    let df = 0
    for (const e of entries) if (e.text.includes(kw)) df++
    return Math.log(1 + N / Math.max(1, df))
  }

  const kwWeights = keywords.map((kw) => {
    const idf = idfOf(kw)
    const grams = kw.length >= 3 && hasCJK(kw) ? bigrams(kw) : null
    return { kw, idf, grams }
  })

  for (const e of entries) {
    const gramRatios = kwWeights.map(({ grams }) => {
      if (grams === null) return null
      let hit = 0
      for (const g of grams) if (e.text.includes(g)) hit++
      return grams.length ? hit / grams.length : 0
    })
    let score = 0
    kwWeights.forEach(({ kw, idf }, ki) => {
      if (e.text.includes(kw)) { score += 2 * idf; return }
      const r = gramRatios[ki]
      if (r !== null && r >= 0.5) score += 1 * r * idf
    })
    if (score <= 0) continue
    if (e.kind === 'stm') {
      const itm = e.e
      results.push({ kind: 'stm', index: e.index, turn: itm.turn, time: itm.time || '', location: itm.location || '', title: itm.title || '', summary: itm.summary, merged: itm.merged_into != null, score })
    } else {
      const f = e.f
      results.push({ kind: 'known_facts', index: e.index, entry: f.entry, summary: f.summary || '', keywords: f.keywords || [], score })
    }
  }

  results.sort((a, b) => b.score - a.score)
  const max = Math.min(10, Math.max(1, Number(limit) || 5))
  return { results: results.slice(0, max), total: results.length }
}

export function anchorSnapshot(anchor) {
  if (!anchor || typeof anchor !== 'object') return '【当前叙事锚定快照】\n（尚无叙事锚定数据）'
  const parts = {}

  const cs = anchor.current_state || {}
  const csParts = []
  if (cs.time) csParts.push(`时间: ${cs.time}`)
  if (cs.world) csParts.push(`世界: ${cs.world}`)
  if (cs.location) csParts.push(`地点: ${cs.location}`)
  if (Array.isArray(cs.characters) && cs.characters.length > 0) csParts.push(`在场人物: ${cs.characters.join(', ')}`)
  if (cs.environment) csParts.push(`环境: ${Array.isArray(cs.environment) ? cs.environment.join('、') : cs.environment}`)
  if (Array.isArray(cs.items) && cs.items.length > 0) csParts.push(`物品: ${cs.items.join(', ')}`)
  if (cs.focus) csParts.push(`叙事备忘: ${cs.focus}`)
  if (csParts.length > 0) parts.state = '【当前状态】\n' + csParts.join('\n')

  const stm = anchor.memory?.stm || []
  const unmergedStm = stm.filter((e) => e.merged_into == null)
  if (unmergedStm.length > 0) {
    const stmText = unmergedStm.slice(-7).map((e, i) => `${i + 1}. [${e.time || ''} @ ${e.location || ''}] ${e.title ? e.title + '：' : ''}${e.summary}`).join('\n')
    parts.stm = `【近期记忆 STM】（未合并 ${unmergedStm.length} 条，共 ${stm.length} 条）\n${stmText}`
  }

  const ltmText = formatLtmTree(anchor)
  if (ltmText) parts.ltm = '【长期记忆 LTM】（根节点摘要）\n' + ltmText

  const allKf = Array.isArray(anchor.memory?.known_facts) ? anchor.memory.known_facts : []
  if (allKf.length > 0) {
    const recent10 = allKf.slice(-10)
    const kfLines = recent10.map(f => `- ${f.entry}：${f.summary || ''}`)
    parts.known = `【已知情报目录】（共 ${allKf.length} 条）\n` + kfLines.join('\n')
  }

  const ordered = [parts.ltm, parts.known, parts.state, parts.stm].filter(Boolean)
  if (ordered.length === 0) return '【当前叙事锚定快照】\n（尚无叙事锚定数据）'
  return '【当前叙事锚定快照】\n' + ordered.join('\n\n')
}
