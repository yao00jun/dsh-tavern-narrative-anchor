/**
 * DSH-Tavern Narrative Anchor & Multi-Dimensional Compaction Plugin
 *
 * 100% 标准热插拔插件（基于官方 DSH-Tavern Plugin API v2）
 * - 零核心文件入侵，零硬编码路径
 * - 接入 ctx.tavern.settlementTool / settlementSection / turnSection
 * - 深度集成 Discussion #184 8维多维结构化上下文压缩协议（ctx.tavern.compactionSection）
 * - 动态世界书条目原生召回（ctx.tavern.worldbookEntries）
 * - 按轮原生持久化（ctx.tavern.saveTurnData / readTurnData）与跨剧情线回退自愈
 * - 生命周期侦听（onTimelineChanged / onGameRemoved）
 * - 前后端标准 RPC 交互（ctx.tavern.handle / ctx.tavernUi.callHost）
 */

import { readAnchor, writeAnchor } from './lib/data-store.js'
import {
  createEmptyAnchor,
  applyAnchorSubmission,
  formatAnchorForInjection,
  getAnchorStats
} from './lib/settlement/store.js'
import {
  NARRATIVE_ANCHOR_READ_TOOL,
  NARRATIVE_ANCHOR_SUBMIT_TOOL,
  searchAnchorMemory
} from './lib/settlement/strategies.js'
import { COMPACTION_8DIM_PROMPT } from './lib/prompts/compactor-8dim.js'
import { SETTLEMENT_INSTRUCTIONS } from './lib/prompts/settlement-rules.js'
import { readSessionWorldbook } from './lib/session-worldbook.js'
import { resolveTavernDataRoot } from './lib/official-worldbook.js'
import { setFamilyDataRoot } from './lib/family.js'
import { handleRpc, SUPPORTED_RPC_METHODS, toHandlerKey } from './lib/router.js'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const logFile = join(here, 'backend.log')
function logInfo(msg) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

export const name = 'dsh-tavern-narrative-anchor'
export const inject = ['tavern']

export function apply(ctx) {
  logInfo('apply(ctx) 开始执行，ctx.tavern=' + !!ctx.tavern)
  if (!ctx.tavern) {
    logInfo('未检测到 ctx.tavern，跳过装载')
    console.warn('[dsh-tavern-narrative-anchor] 未检测到 ctx.tavern，跳过酒馆宿主侧装载。')
    return
  }

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
          anchor.memory.known_facts.forEach((fact, i) => {
            if (!fact || !fact.entry) return
            const kw = Array.isArray(fact.keywords) && fact.keywords.length > 0 ? fact.keywords : [String(fact.entry)]
            // POOL_ENTRY_ID 严格限制 /^[A-Za-z0-9._-]{1,64}$/
            // 使用稳定 hash + 序号，彻底防止中文标题导致的字符丢失与 ID 冲突
            const hash = createHash('md5').update(String(fact.entry)).digest('hex').slice(0, 12)
            list.push({
              id: `kf_${i}_${hash}`,
              title: String(fact.entry).slice(0, 200),
              content: String(fact.summary || '').slice(0, 4000),
              keys: kw,
              constant: false
            })
          })
        }

        // 5b. 会话临时世界书 (session-worldbook)
        const book = readSessionWorldbook(gameId)
        if (book && book.enabled !== false && Array.isArray(book.entries)) {
          book.entries.forEach((entry, i) => {
            if (!entry || entry.enabled === false) return
            const hash = createHash('md5').update(String(entry.title || i)).digest('hex').slice(0, 12)
            list.push({
              id: `swb_${i}_${hash}`,
              title: String(entry.title || '').slice(0, 200),
              content: String(entry.content || '').slice(0, 4000),
              keys: Array.isArray(entry.keys) ? entry.keys : [],
              secondaryKeys: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
              constant: entry.constant === true
            })
          })
        }
      } catch (e) {
        console.error('[dsh-tavern-narrative-anchor] worldbookEntries 召回异常:', e)
      }
      return list
    }
  })

  // ────────────────── 6. 生命周期钩子侦听 ──────────────────
  ctx.tavern.onTimelineChanged?.(({ gameId, change }) => {
    console.log(`[dsh-tavern-narrative-anchor] 剧情线发生变动 (${change?.kind || '未知'}):`, gameId)
  })

  ctx.tavern.onGameRemoved?.(({ gameId }) => {
    console.log(`[dsh-tavern-narrative-anchor] 游戏会话已移除:`, gameId)
  })

  // ────────────────── 7. 前端 RPC 处理程序 (ctx.tavern.handle) ──────────────────
  let registeredCount = 0
  for (const method of SUPPORTED_RPC_METHODS) {
    const handlerKey = toHandlerKey(method)
    try {
      ctx.tavern.handle(handlerKey, async (args) => {
        logInfo(`RPC 调用: ${handlerKey}`)
        try {
          const res = await handleRpc(method, args, ctx)
          return res
        } catch (callErr) {
          logInfo(`RPC 执行错误 [${handlerKey}]: ${callErr?.message || callErr}`)
          throw callErr
        }
      })
      registeredCount++
    } catch (err) {
      logInfo(`注册 RPC 处理器 ${handlerKey} 失败: ${err?.message || err}`)
      console.warn(`[dsh-tavern-narrative-anchor] 注册 RPC 处理器 ${handlerKey} 失败:`, err)
    }
  }
  logInfo(`成功注册 ${registeredCount}/${SUPPORTED_RPC_METHODS.length} 个 RPC 处理器`)

  // ────────────────── 8. 向下兼容 HTTP 接口（若有独立前端通过 fetch 访问） ──────────────────
  const registerHttp = (webServer, targetCtx) => {
    if (!webServer || typeof webServer.register !== 'function') return
    const effect = targetCtx && typeof targetCtx.effect === 'function'
      ? targetCtx.effect.bind(targetCtx)
      : (fn => fn())
    effect(() => {
      return webServer.register({
        kind: 'prefix',
        path: '/api/narrative-anchor',
        handler: async (req, res) => {
          const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
          const rawMethod = pathname.replace(/^\/api\/narrative-anchor\/?/, '')
          let body = {}
          if (req.method === 'POST') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) } catch { body = {} }
          }
          const result = await handleRpc(rawMethod, body, ctx)
          res.writeHead(result?.ok !== false ? 200 : 400, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          })
          res.end(JSON.stringify(result))
        }
      })
    }, 'dsh-tavern-narrative-anchor: webServer routes')
    logInfo('HTTP 路由 /api/narrative-anchor 已注册')
  }

  const directWs = (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined) || ctx.webServer
  if (directWs) {
    registerHttp(directWs, ctx)
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scoped) => {
      const ws = (typeof scoped?.get === 'function' ? scoped.get('webServer') : undefined) || scoped?.webServer
      registerHttp(ws, scoped)
    })
  }

  logInfo('apply(ctx) 全部执行完毕！')
  console.log('[dsh-tavern-narrative-anchor] 插件已通过官方 Tavern API v2 规范成功挂载！')
}
