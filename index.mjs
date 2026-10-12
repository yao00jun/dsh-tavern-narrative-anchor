/**
 * DSH-Tavern Narrative Anchor & Multi-Dimensional Compaction Plugin
 *
 * 100% 标准热插拔插件（基于官方 DSH-Tavern Plugin API v2）
 * - 零核心文件入侵，零硬编码路径
 * - 接入 ctx.tavern.settlementTool / settlementSection / turnSection
 * - 深度集成 Discussion #184 8维多维结构化上下文压缩协议（ctx.tavern.compactionSection）
 * - 动态世界书条目原生召回（ctx.tavern.worldbookEntries）
 * - 按轮原生持久化（ctx.tavern.saveTurnData / readTurnData）与跨剧情线回退自愈
 * - 前后端标准 RPC 交互（ctx.tavern.handle / ctx.tavernUi.callHost）
 */

import { readAnchor, writeAnchor, readSnapshotLog, writeSnapshotLog } from './lib/data-store.js'
import {
  loadAnchor,
  createEmptyAnchor,
  applyAnchorSubmission,
  formatAnchorForInjection,
  getAnchorStats,
  updateLtmSnapshot
} from './lib/settlement/store.js'
import {
  NARRATIVE_ANCHOR_READ_TOOL,
  NARRATIVE_ANCHOR_SUBMIT_TOOL,
  searchAnchorMemory,
  anchorSnapshot
} from './lib/settlement/strategies.js'
import { COMPACTION_8DIM_PROMPT } from './lib/prompts/compactor-8dim.js'
import { SETTLEMENT_INSTRUCTIONS } from './lib/prompts/settlement-rules.js'
import {
  readSessionWorldbook,
  loadSessionWorldbook,
  writeSessionWorldbook,
  listSessionWorldbooks,
  selectedEntries,
  toWorldbookEntries
} from './lib/session-worldbook.js'
import {
  listCombos,
  createCombo,
  updateCombo,
  deleteCombo,
  listGlobalAutoBind,
  setGlobalAutoBind,
  toggleGlobalAutoBind
} from './lib/worldbook-combos.js'
import {
  resolveTavernDataRoot,
  readChatFromDisk,
  readLatestChatFromDisk
} from './lib/official-worldbook.js'
import {
  setFamilyDataRoot,
  resolveFamilyId,
  registerBranch,
  familyMembers,
  rootOf,
  readRegistry,
  unregisterBranch,
  sessionAlive,
  sessionTitle,
  deleteFamilyFile
} from './lib/family.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

export const name = 'dsh-tavern-narrative-anchor'
export const inject = ['tavern', 'webServer']

export function apply(ctx) {
  if (!ctx.tavern) {
    console.warn('[dsh-tavern-narrative-anchor] 未检测到 ctx.tavern，跳过酒馆宿主侧装载。')
    return
  }

  const here = dirname(fileURLToPath(import.meta.url))
  setFamilyDataRoot(resolveTavernDataRoot(undefined, []))

  // ────────────────── 1. 后台结算工具 ──────────────────

  // 1a. 叙事锚点提交工具 (narrative_anchor_submit)
  ctx.tavern.settlementTool({
    name: NARRATIVE_ANCHOR_SUBMIT_TOOL.name,
    description: NARRATIVE_ANCHOR_SUBMIT_TOOL.description,
    parameters: NARRATIVE_ANCHOR_SUBMIT_TOOL.parameters,
    async execute({ gameId, turn, arguments: args }) {
      try {
        const prevSaved = await ctx.tavern.readTurnData({ gameId, turn })
        const currentAnchor = prevSaved?.data || readAnchor(gameId) || createEmptyAnchor()

        const updated = applyAnchorSubmission(currentAnchor, args, { turn })

        // 写入 Tavern 官方按轮存档数据
        await ctx.tavern.saveTurnData({ gameId, turn, data: updated })
        // 同步写本地磁盘快照，供 WebUI / 独立面板快速读取
        writeAnchor(gameId, updated)

        return { ok: true, stats: getAnchorStats(updated) }
      } catch (err) {
        return { ok: false, error: err?.message || String(err) }
      }
    }
  })

  // 1b. 叙事记忆检索工具 (narrative_anchor_read)
  ctx.tavern.settlementTool({
    name: NARRATIVE_ANCHOR_READ_TOOL.name,
    description: NARRATIVE_ANCHOR_READ_TOOL.description,
    parameters: NARRATIVE_ANCHOR_READ_TOOL.parameters,
    async execute({ gameId, turn, arguments: args }) {
      try {
        const prevSaved = await ctx.tavern.readTurnData({ gameId, turn })
        const anchor = prevSaved?.data || readAnchor(gameId) || createEmptyAnchor()
        const query = args?.query || ''
        const kind = args?.kind || 'all'
        const limit = args?.limit || 5
        const { results, total } = searchAnchorMemory(anchor, query, kind, limit)
        return { ok: true, query, kind, total, returned: results.length, results }
      } catch (err) {
        return { ok: false, error: err?.message || String(err) }
      }
    }
  })

  // ────────────────── 2. 后台结算说明注入 ──────────────────
  ctx.tavern.settlementSection({
    name: 'narrative-anchor-settlement-instructions',
    text: ({ gameId }) => {
      const anchor = readAnchor(gameId)
      if (anchor?.meta?.settings?.enabled === false) return ''
      return SETTLEMENT_INSTRUCTIONS
    }
  })

  // ────────────────── 3. 前台轮次上下文注入 ──────────────────
  ctx.tavern.turnSection({
    name: 'narrative-anchor-current-state',
    position: 'after',
    text: async ({ gameId, turn }) => {
      const saved = await ctx.tavern.readTurnData({ gameId, turn })
      const anchor = saved?.data || readAnchor(gameId)
      if (!anchor || anchor?.meta?.settings?.enabled === false) return ''
      return formatAnchorForInjection(anchor)
    }
  })

  // ────────────────── 4. 上下文历史压缩（Discussion #184 8维协议）──────────────────
  ctx.tavern.compactionSection({
    name: 'narrative-anchor-compaction-8dim',
    text: () => {
      return COMPACTION_8DIM_PROMPT
    }
  })

  // ────────────────── 5. 动态世界书条目原生召回池 ──────────────────
  ctx.tavern.worldbookEntries({
    name: 'narrative-anchor-worldbook',
    entries: async ({ gameId, turn }) => {
      const list = []
      try {
        const saved = await ctx.tavern.readTurnData({ gameId, turn })
        const anchor = saved?.data || readAnchor(gameId)

        // 5a. 已知客观情报 (known_facts)
        if (anchor && Array.isArray(anchor.memory?.known_facts)) {
          for (const fact of anchor.memory.known_facts) {
            if (!fact || !fact.entry) continue
            const kw = Array.isArray(fact.keywords) && fact.keywords.length > 0 ? fact.keywords : [fact.entry]
            list.push({
              id: 'kf-' + String(fact.id || fact.entry).replace(/[^\w-]/g, '_'),
              title: fact.entry,
              content: fact.summary || '',
              keys: kw,
              constant: false
            })
          }
        }

        // 5b. 会话临时世界书 (session-worldbook)
        const book = readSessionWorldbook(gameId)
        if (book && book.enabled !== false && Array.isArray(book.entries)) {
          for (const entry of book.entries) {
            if (!entry || entry.enabled === false) continue
            list.push({
              id: 'swb-' + String(entry.id || entry.title).replace(/[^\w-]/g, '_'),
              title: entry.title || '',
              content: entry.content || '',
              keys: Array.isArray(entry.keys) ? entry.keys : [],
              secondaryKeys: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
              constant: entry.constant === true
            })
          }
        }
      } catch (e) {
        console.error('[dsh-tavern-narrative-anchor] worldbookEntries 召回异常:', e)
      }
      return list
    }
  })

  // ────────────────── 6. 核心 RPC 处理程序 (ctx.tavern.handle) ──────────────────

  async function handleRpc(method, body = {}) {
    const sessionId = body.sessionId || body.gameId || ''

    switch (method) {
      case 'getConfig': {
        const anchor = readAnchor(sessionId) || createEmptyAnchor()
        const settings = anchor.meta?.settings || {}
        return {
          ok: true,
          settings: {
            enabled: settings.enabled !== false,
            maxSTMLength: settings.maxSTMLength || 7,
            injectPosition: settings.injectPosition || 'after',
            projectionReplace: settings.projectionReplace === true,
            skipAllPresentLtm: settings.skipAllPresentLtm !== false
          },
          stats: getAnchorStats(anchor)
        }
      }

      case 'setConfig': {
        const anchor = readAnchor(sessionId) || createEmptyAnchor()
        if (!anchor.meta.settings) anchor.meta.settings = {}
        if (typeof body.maxSTMLength === 'number') anchor.meta.settings.maxSTMLength = Math.max(1, Math.min(50, Math.floor(body.maxSTMLength)))
        if (typeof body.injectPosition === 'string') anchor.meta.settings.injectPosition = body.injectPosition
        if (typeof body.enabled === 'boolean') anchor.meta.settings.enabled = body.enabled
        if (typeof body.projectionReplace === 'boolean') anchor.meta.settings.projectionReplace = body.projectionReplace
        if (typeof body.skipAllPresentLtm === 'boolean') anchor.meta.settings.skipAllPresentLtm = body.skipAllPresentLtm

        if (body.reset === true) {
          anchor.plot_route = { current_node: '', recap: '', next_scene: '', foreshadowing: [] }
          anchor.current_state = { time: '', world: '', location: '', characters: [], environment: [], items: [], focus: '', focus_full: '' }
          anchor.memory = { stm: [], ltm_tree: { nodes: {}, roots: [], next_id: 1 }, ltm_snapshot: { content: '', turn: 0 }, known_facts: [], foreshadow_library: [] }
        }

        anchor.meta.updated_at = Date.now()
        writeAnchor(sessionId, anchor)
        return { ok: true, note: '设置已更新并持久化' }
      }

      case 'getData': {
        const anchor = readAnchor(sessionId)
        if (!anchor) return { ok: true, anchor: null, display: '（暂无数据）' }
        return { ok: true, anchor, display: formatAnchorForInjection(anchor) }
      }

      case 'updateData': {
        const anchor = readAnchor(sessionId) || createEmptyAnchor()
        if (!body.data || typeof body.data !== 'object') {
          return { ok: false, error: '缺少 data 参数' }
        }
        const incoming = body.data
        if (incoming.current_state && typeof incoming.current_state === 'object') anchor.current_state = incoming.current_state
        if (incoming.memory && typeof incoming.memory === 'object') {
          if (Array.isArray(incoming.memory.stm)) anchor.memory.stm = incoming.memory.stm
          if (incoming.memory.ltm_tree && typeof incoming.memory.ltm_tree === 'object') anchor.memory.ltm_tree = incoming.memory.ltm_tree
          if (Array.isArray(incoming.memory.known_facts)) anchor.memory.known_facts = incoming.memory.known_facts
        }
        updateLtmSnapshot(anchor)
        anchor.meta.updated_at = Date.now()
        writeAnchor(sessionId, anchor)
        return { ok: true, note: '锚点数据已更新', stats: getAnchorStats(anchor) }
      }

      case 'getPosture': {
        return { ok: true, posture: '', postureEnabled: true, lastSettle: null }
      }

      case 'worldbook/list': {
        return { ok: true, sessions: listSessionWorldbooks() }
      }

      case 'worldbook/get': {
        const book = loadSessionWorldbook(sessionId)
        return { ok: true, book }
      }

      case 'worldbook/save': {
        if (!body.book || typeof body.book !== 'object') return { ok: false, error: '缺少 book 数据' }
        const ok = writeSessionWorldbook(body.book)
        return { ok }
      }

      case 'worldbook/combos': {
        return { ok: true, combos: listCombos(), globalAutoBind: listGlobalAutoBind() }
      }

      case 'branch/prepare': {
        const dataRoot = resolveTavernDataRoot(undefined, [])
        const diskChat = readChatFromDisk(dataRoot, sessionId)
        let latestTurn = 0
        let cardName = diskChat?.cardName || ''
        if (diskChat && Array.isArray(diskChat.messages)) {
          for (const m of diskChat.messages) {
            const t = Number(m?.turn) || 0
            if (t > latestTurn) latestTurn = t
          }
        }
        return { ok: true, chatId: diskChat?.id || sessionId, sessionId, turn: latestTurn, cardName }
      }

      case 'branch/register': {
        const sid = String(body.sessionId || '')
        const parentSid = String(body.parentSid || '')
        if (!sid || !parentSid) return { ok: false, error: '需要 sessionId 与 parentSid' }
        const familyId = String(body.familyId || '') || rootOf(parentSid)
        const member = registerBranch({ sessionId: sid, familyId, parentSid, label: body.label })
        return { ok: true, member }
      }

      case 'branch/list': {
        const fid = body.familyId || resolveFamilyId(sessionId)
        return { ok: true, familyId: fid, members: familyMembers(fid) }
      }

      case 'branch/delete': {
        const sid = body.sessionId
        unregisterBranch(sid)
        return { ok: true }
      }

      default:
        return { ok: false, error: `未知的操作方法: ${method}` }
    }
  }

  // 注册所有 tavern RPC 方法
  const rpcMethods = [
    'getConfig',
    'setConfig',
    'getData',
    'updateData',
    'getPosture',
    'worldbook/list',
    'worldbook/get',
    'worldbook/save',
    'worldbook/combos',
    'branch/prepare',
    'branch/register',
    'branch/list',
    'branch/delete'
  ]

  for (const method of rpcMethods) {
    ctx.tavern.handle(`dsh-tavern-narrative-anchor/${method}`, async (args) => {
      return handleRpc(method, args)
    })
  }

  // ────────────────── 7. 向下兼容 HTTP 接口（若有独立前端通过 fetch 访问） ──────────────────
  ctx.effect(() => {
    const webServer = ctx.get('webServer')
    if (!webServer || typeof webServer.register !== 'function') return

    return webServer.register({
      kind: 'prefix',
      path: '/api/narrative-anchor',
      handler: async (req, res) => {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
        const method = pathname.replace('/api/narrative-anchor/', '')
        let body = {}
        if (req.method === 'POST') {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) } catch { body = {} }
        }
        const result = await handleRpc(method, body)
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(result))
      }
    })
  }, 'dsh-tavern-narrative-anchor: legacy webServer')

  console.log('[dsh-tavern-narrative-anchor] 插件已通过官方 Tavern API v2 规范成功挂载！')
}
