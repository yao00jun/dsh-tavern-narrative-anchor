/**
 * DSH-Tavern Narrative Anchor - RPC & HTTP Router
 * 完整实现前端 WebUI 面板与 Tavern 宿主所需的所有操作方法
 */

import { readAnchor, writeAnchor, readSnapshotLog, writeSnapshotLog } from './data-store.js'
import {
  loadAnchor,
  createEmptyAnchor,
  formatAnchorForInjection,
  getAnchorStats,
  updateLtmSnapshot,
  formatLtmTree
} from './settlement/store.js'
import {
  resolveTavernDataRoot,
  readOfficialWorldbooks,
  readRecallAudit,
  readRecallHistory,
  readChatFromDisk,
  readLatestChatFromDisk,
  readLatestReplyContext,
  entryPresentInContext,
  updateOfficialEntry
} from './official-worldbook.js'
import {
  readSessionWorldbook,
  loadSessionWorldbook,
  writeSessionWorldbook,
  listSessionWorldbooks,
  autoImportFromAnchor,
  syncSidelineEntries,
  removeSidelineEntries,
  boundWorldbookEntries,
  effectiveBoundBooks,
  readBoundWorldbookDocument,
  writeBoundWorldbookDocument
} from './session-worldbook.js'
import {
  listCombos,
  createCombo,
  updateCombo,
  deleteCombo,
  listGlobalAutoBind,
  setGlobalAutoBind,
  toggleGlobalAutoBind
} from './worldbook-combos.js'
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
  deleteFamilyFile,
  clearFamilyCaches
} from './family.js'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SUPPORTED_RPC_METHODS = [
  'list',
  'getConfig',
  'paths',
  'setConfig',
  'getData',
  'updateData',
  'getPosture',
  'worldbook/list',
  'worldbook/get',
  'worldbook/save',
  'worldbook/entry',
  'worldbook/entries-clear',
  'worldbook/history',
  'worldbook/library',
  'worldbook/bind',
  'worldbook/global-bind',
  'worldbook/combos',
  'worldbook/select',
  'worldbook/settings',
  'branch/prepare',
  'branch/register',
  'branch/inspectSessions',
  'branch/injectSystemNote',
  'branch/injectGreeting',
  'branch/unbind',
  'branch/bind',
  'branch/sync',
  'branch/families',
  'branch/merge',
  'branch/rename',
  'branch/list',
  'branch/delete'
]

export function normalizeMethod(method) {
  const map = {
    'get-config': 'getConfig',
    'set-config': 'setConfig',
    'get-data': 'getData',
    'update-data': 'updateData',
    'get-posture': 'getPosture',
    'branch/inspect-sessions': 'branch/inspectSessions',
    'branch/inject-system-note': 'branch/injectSystemNote',
    'branch/inject-greeting': 'branch/injectGreeting',
  }
  return map[method] || method
}

export function toHandlerKey(method) {
  // 官方 HANDLER_NAME: /^[a-z0-9][a-z0-9._:/-]{0,95}$/ 严格禁止大写字母
  const kebab = String(method || '').replace(/[A-Z]/g, c => '-' + c.toLowerCase())
  return `dsh-tavern-narrative-anchor/${kebab}`
}

export async function handleRpc(method, body = {}, ctx = null) {
  const effectiveMethod = normalizeMethod(method)
  const dataRoot = resolveTavernDataRoot(undefined, [])
  const sessionId = body.sessionId || body.gameId || ''
  const chat = readChatFromDisk(dataRoot, sessionId) || readLatestChatFromDisk(dataRoot)
  const config = { maxSTMLength: 7, injectPosition: 'after' }
  const sendJson = (data, status = 200) => data

  try {
switch (effectiveMethod) {
            case 'list': {
              const ext = ctx.tavernExtensionPoints || ctx.get('tavernExtensionPoints')
              return sendJson({ ok: true, registry: ext ? ext.list() : { background: [], foreground: [] }, note: '扩展点注册状态' })
            }
            case 'getConfig': {
              // v0.6.7：以插件自持文件为权威源（零 DSHT 依赖），不再读内存 chat
              const anchor = readAnchor(sessionId) || loadAnchor(chat || {})
              const settings = anchor.meta.settings || {}
              return sendJson({ ok: true, settings: { enabled: settings.enabled !== false, maxSTMLength: settings.maxSTMLength || config.maxSTMLength, injectPosition: settings.injectPosition || config.injectPosition, projectionReplace: settings.projectionReplace === true, skipAllPresentLtm: settings.skipAllPresentLtm !== false }, stats: getAnchorStats(anchor) })
            }
            case 'paths': {
              // v0.9.x：关键配置与工具的本地绝对路径（全部运行时推导，非写死）。
              const here = dirname(fileURLToPath(import.meta.url))
              const local = rel => { try { return fileURLToPath(new URL(rel, import.meta.url)) } catch { return '' } }
              const exists = p => { try { return existsSync(p) } catch { return false } }
              // dataRoot = <harness>/profile-data/tavern/data → harness 根上溯 3 级
              const dataRoot = resolveTavernDataRoot(undefined, [config.tavernDataRoot].filter(Boolean))
              const harnessRoot = dirname(dirname(dirname(dataRoot)))
              const junctionPath = join(harnessRoot, 'profiles', 'tavern', 'node_modules', 'narrative-anchor')
              const devRoot = dirname(here)
              return sendJson({
                ok: true,
                paths: {
                  pluginEntry: { path: local('./index.js'), desc: '插件主入口：工具注册、后台结算/前台注入装配' },
                  clientEntry: { path: local('./client.js'), desc: '设置页/状态页 UI（本页面）' },
                  settlementStrategies: { path: local('./settlement/strategies.js'), desc: '锚点提交/检索工具定义（narrative_anchor_submit schema）、注入文案' },
                  settlementStore: { path: local('./settlement/store.js'), desc: '结算存储：LTM 归并、锚点统计' },
                  sessionWorldbook: { path: local('./session-worldbook.js'), desc: '会话临时世界书（合并/同步）' },
                  anchorsDir: { path: join(devRoot, 'data', 'anchors'), desc: '锚点数据存储（<插件目录>/data/anchors/<sessionId>.json）' },
                  sessionWorldbooksDir: { path: join(devRoot, 'data', 'session-worldbooks'), desc: '会话临时世界书存储' },
                  patchSource: { path: join(devRoot, 'patches', 'tavern-plugin'), desc: 'DSHT 扩展注册点补丁权威源（修改入口，禁止直接改运行时）' },
                  tavernDataRoot: { path: dataRoot, desc: 'DSH 用户数据根（角色卡/世界书/对话快照）' },
                  junctionPath: { path: junctionPath, desc: exists(junctionPath) ? 'profile 安装位（junction，指向开发目录）' : '', present: exists(junctionPath) },
                },
              })
            }
            case 'setConfig': {
              // v0.6.7：设置持久化到自持文件（权威源），立即生效且重启不丢
              const anchor = readAnchor(sessionId) || loadAnchor(chat || {})
              if (!anchor.meta.settings) anchor.meta.settings = {}
              if (typeof body.maxSTMLength === 'number') anchor.meta.settings.maxSTMLength = Math.max(1, Math.min(50, Math.floor(body.maxSTMLength)))
              if (typeof body.injectPosition === 'string') anchor.meta.settings.injectPosition = body.injectPosition
              if (typeof body.enabled === 'boolean') anchor.meta.settings.enabled = body.enabled
              if (typeof body.projectionReplace === 'boolean') anchor.meta.settings.projectionReplace = body.projectionReplace
              if (typeof body.skipAllPresentLtm === 'boolean') anchor.meta.settings.skipAllPresentLtm = body.skipAllPresentLtm
              if (body.reset === true) { anchor.plot_route = { current_node: '', recap: '', next_scene: '', foreshadowing: [] }; anchor.current_state = { time: '', world: '', location: '', characters: [], environment: [], items: [] }; anchor.memory = { stm: [], ltm: [], ltm_tree: { nodes: {}, roots: [], next_id: 1 }, ltm_snapshot: { content: '', turn: 0 }, known_facts: [], foreshadow_library: [] } }
              anchor.meta.updated_at = Date.now()
              writeAnchor(sessionId, anchor)
              return sendJson({ ok: true, note: '设置已更新并持久化' })
            }
            case 'getData': {
              // v0.6.6：优先读插件自持数据文件（零 DSHT 依赖）；无文件回退运行时 chat
              const anchor = readAnchor(sessionId) || (chat && chat.narrativeAnchor) || null
              if (!anchor) return sendJson({ ok: true, anchor: null, display: '（暂无数据）' })
              return sendJson({ ok: true, anchor, display: formatAnchorForInjection(anchor) })
            }
            case 'updateData': {
              // v0.9.0：人工编辑锚点数据（current_state / stm / ltm_tree / known_facts）
              // body.data 为完整的 anchor 对象或部分字段（部分字段时合并）
              // v0.9.1：修复内存覆盖问题——写入文件后必须同步更新内存 chat.narrativeAnchor，
              //         否则后续结算从内存读取旧数据会覆盖文件中的界面编辑修改
              const anchor = readAnchor(sessionId) || loadAnchor(chat || {})
              if (!body.data || typeof body.data !== 'object') {
                return sendJson({ ok: false, error: '缺少 data 参数' }, 400)
              }
              const incoming = body.data
              // 合并顶层字段
              if (incoming.current_state && typeof incoming.current_state === 'object') anchor.current_state = incoming.current_state
              if (incoming.memory && typeof incoming.memory === 'object') {
                if (Array.isArray(incoming.memory.stm)) anchor.memory.stm = incoming.memory.stm
                if (incoming.memory.ltm_tree && typeof incoming.memory.ltm_tree === 'object') anchor.memory.ltm_tree = incoming.memory.ltm_tree
                if (Array.isArray(incoming.memory.known_facts)) anchor.memory.known_facts = incoming.memory.known_facts
              }
              // 重新计算 LTM 快照
              updateLtmSnapshot(anchor)
              anchor.meta.updated_at = Date.now()
              writeAnchor(sessionId, anchor)
              // 同步更新内存中的 chat.narrativeAnchor（防止后续结算用内存旧数据覆盖文件）
              if (chat && typeof chat === 'object') {
                chat.narrativeAnchor = anchor
              }
              return sendJson({ ok: true, note: '锚点数据已更新（文件+内存已同步）', stats: getAnchorStats(anchor) })
            }
            case 'getPosture': {
              // 从内存会话读取当前姿势描述（chat.posture 纯字符串字段）；
              // 不读磁盘（readChatFromDisk 有 .json.gz 缺陷），内存无数据时返回空结构。
              const memChat = getChatFromSession(ctx, sessionId)
              if (memChat && typeof memChat.posture === 'string') {
                return sendJson({
                  ok: true,
                  posture: memChat.posture,
                  postureEnabled: memChat.backgroundTasks?.posture !== false,
                  lastSettle: memChat.lastSettle || null
                })
              }
              return sendJson({ ok: true, posture: '', postureEnabled: true, lastSettle: null, note: '当前会话无内存 chat 数据' })
            }
            // ── v0.7：人工世界书管理系统 ──
            case 'worldbook/list': {
              return sendJson({ ok: true, sessions: listSessionWorldbooks() })
            }
            // ── v0.9.16 支线系统 ──
            case 'branch/prepare': {
              // 为"创建支线"准备官方 fork 三步所需的参数：chatId + 最新完成轮。
              // 内存 chat 可能是未完全加载的骨架（消息缺 turn → 误算成第 1 轮，fork 出空会话），
              // 主从场景还可能拿错会话——因此磁盘快照与内存 chat 都算 turn，取最大值
              const sid = body.sessionId
              const dataRoot = resolveTavernDataRoot(undefined, [config.tavernDataRoot].filter(Boolean))
              const diskChat = readChatFromDisk(dataRoot, sid)
              const memChat = getChatFromSession(ctx, sid)
              const candidates = []
              if (memChat && String(memChat.sessionId) === String(sid)) candidates.push(memChat)
              if (diskChat && String(diskChat.sessionId) === String(sid)) candidates.push(diskChat)
              const chatData = candidates[0]
              if (!chatData) return sendJson({ ok: false, error: '找不到会话对应的对话数据' }, 404)
              let latestTurn = 0
              let cardName = ''
              for (const c of candidates) {
                cardName = cardName || c.cardName || ''
                for (const m of (Array.isArray(c.messages) ? c.messages : [])) {
                  const t = Number(m?.turn) || 0
                  if (t > latestTurn) { latestTurn = t; cardName = c.cardName || cardName }
                }
              }
              if (latestTurn === 0) return sendJson({ ok: false, error: '会话尚无已完成的回合，无法创建支线' }, 400)
              return sendJson({ ok: true, chatId: chatData.id, sessionId: chatData.sessionId, turn: latestTurn, cardName })
            }
            case 'branch/register': {
              try {
                const sid = String(body.sessionId || '')
                const parentSid = String(body.parentSid || '')
                if (!sid || !parentSid) return sendJson({ ok: false, error: '需要 sessionId 与 parentSid' }, 400)
                const familyId = String(body.familyId || '') || rootOf(parentSid)
                const member = registerBranch({ sessionId: sid, familyId, parentSid, label: body.label })
                // 创建支线结束时清空支线锚点信息：不继承 fork 继承的 chat.narrativeAnchor 主线数据。
                // ① 清空支线 chat 的 narrativeAnchor（结算 loadAnchor 的数据源）
                // ② 写空锚点文件（readAnchor 的数据源），避免 readAnchor 回退到 chat.narrativeAnchor。
                // 支线从空锚点开始独立演化，避免继承主线锚点造成的已知情报/LTM 重复。
                const emptyAnchor = () => ({
                  plot_route: { current_node: '', recap: '', next_scene: '', foreshadowing: [] },
                  current_state: { time: '', world: '', location: '', characters: [], environment: [], items: [], focus: '', focus_full: '' },
                  memory: {
                    stm: [],
                    ltm_tree: { nodes: {}, roots: [], next_id: 1 },
                    ltm_snapshot: { content: '', turn: 0 },
                    known_facts: [],
                    foreshadow_library: []
                  },
                  meta: { turn_count: 0, created_at: Date.now() }
                })
                try {
                  const chat = getChatFromSession(ctx, sid)
                  if (chat) chat.narrativeAnchor = emptyAnchor()
                } catch { /* 拿不到会话 chat 时仅写空锚点文件 */ }
                writeAnchor(sid, emptyAnchor())
                return sendJson({ ok: true, member, familyId })
              } catch (err) {
                return sendJson({ ok: false, error: String(err?.message || err) }, 400)
              }
            }
            case 'branch/inspectSessions': {
              try {
                const sessions = ctx.get('sessions')
                const agents = ctx.get('agents')
                const sid = String(body.sessionId || '')
                const sess = (agents?.get?.(sid)?.session) || sessions?.get?.(sid)
                if (!sess) return sendJson({ ok: true, found: false })
                const sessIdent = { sid, hasSeq: sess.seq, sessionId: sess.sessionId || sess.id || null, chatId: sess.chatId || null }
                let events = []
                try {
                  events = (typeof sess.snapshotEvents === 'function' ? sess.snapshotEvents() : (Array.isArray(sess.events) ? sess.events : [])).map(e => ({
                    seq: e.seq, type: e.type, turn: e.data?.turn, step: e.data?.step,
                    id: e.data?.message?.id || e.data?.id,
                    text: (e.data?.message?.content?.[0]?.text || e.data?.content?.[0]?.text || '').slice(0, 80),
                    surfaceOp: e.surfaceOp
                  }))
                } catch (e) { events = [{ error: String(e) }] }
                let surface = null
                try {
                  const nodes = sess.surface?.nodes
                  surface = Array.isArray(nodes) ? nodes.map(n => {
                    const t = typeof n
                    if (t === 'object') return { keys: Object.keys(n).slice(0, 12), seq: n.seq, type: n.type || n.kind || null }
                    return n
                  }) : String(nodes)
                } catch (e) { surface = 'error: ' + e.message }
                let derived = null
                try {
                  if (typeof sess.deriveMessages === 'function') {
                    derived = sess.deriveMessages().map(m => ({
                      role: m.role, id: m.id, source: m.source?.kind,
                      text: String(m.content?.[0]?.text || m.text || '').slice(0, 60)
                    })).slice(-8)
                  }
                } catch (e) { derived = 'error: ' + e.message }
                return sendJson({ ok: true, found: true, sessIdent, seq: sess.seq, events: events.slice(-15), surface, derived })
              } catch (err) {
                return sendJson({ ok: false, error: String(err?.message || err) }, 500)
              }
            }
            case 'branch/injectSystemNote': {
              // v0.9.21 起废弃：会话层 system/message 会在下一轮 claim 时被 DSH 核心替换成
              // 空墓碑（实测 seq 964 replace 951），永远进不了请求。分支提示已改为请求期
              // 注入（registerMessageProjection 'narrative-anchor:branch-note'），本端点保留
              // 仅作兼容空操作。
              return sendJson({ ok: true, deprecated: 'branch-note is injected at request time via message projection' })
            }
            case 'branch/injectGreeting': {
              try {
                const sid = String(body.sessionId || '')
                const text = String(body.text || '')
                if (!sid || !text) return sendJson({ ok: false, error: '需要 sessionId 与 text' }, 400)
                const sessions = ctx.get('sessions')
                const agents = ctx.get('agents')
                const session = (agents?.get?.(sid)?.session) || sessions?.get?.(sid)
                if (!session) return sendJson({ ok: false, error: '找不到 session（agents/sessions 均未命中）' }, 404)
                const msgId = 'branch-greeting:' + Date.now()
                // 官方机制对齐（conversation-initialization.js appendNativeOpening 双写模式）：
                // 1) 会话层：完整合成轮 turn/start(N) → step/start → assistant/message → step/end →
                //    turn/end；V3 给 assistant data 补 stream: []。（裸 turn:0 曾致历史加载崩溃）
                // 2) chat 层：界面气泡只渲染 chat.messages，必须 push 一条对应消息（官方开场白同款形状）。
                // 3) agent.phase.lastTurn 同步顺延到 N——循环下一轮号来源于它（官方导入路径同款），
                //    否则真实第 N 轮与问候合成轮撞号（曾观察到两个 turn/start {turn:70}）。
                // chat 层消息随下一次真实轮 commit 落盘；重启前未发首条消息则气泡仅会话层留存。
                const snapshot = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : (Array.isArray(session.events) ? session.events : [])
                let lastTurn = 0
                for (const ev of snapshot) {
                  const t = ev?.data?.turn
                  if (typeof t === 'number' && t > lastTurn) lastTurn = t
                }
                const turn = lastTurn + 1
                const isV3 = session?.header?.version >= 3
                const assistantData = {
                  turn,
                  step: 1,
                  message: {
                    id: msgId,
                    role: 'assistant',
                    content: [{ type: 'text', text }],
                    source: { kind: 'model', provider: 'dsh-tavern', model: 'narrative-anchor-greeting' }
                  }
                }
                if (isV3) assistantData.stream = []
                session.append('turn/start', { turn })
                session.append('step/start', { turn, step: 1 })
                session.append('assistant/message', assistantData, { surfaceOp: 'append' })
                session.append('step/end', { turn, step: 1 })
                session.append('turn/end', { turn, reason: { kind: 'completed' } })
                // 双写 chat 层（官方开场白消息形状，不含 MVU/swipe 字段；不置 greeting:true 以免触发开场逻辑）
                const chat = session.chat || getChatFromSession(ctx, sid) || (typeof session === 'object' ? session.chat : null)
                let chatWritten = false
                if (chat && Array.isArray(chat.messages)) {
                  chat.messages.push({
                    role: 'assistant',
                    text,
                    sourceText: text,
                    projectionText: text,
                    displayText: '',
                    displayMode: 'all',
                    projectionVersion: 2,
                    projectionWarnings: [],
                    ts: Date.now(),
                    turn
                  })
                  chat.updatedAt = Date.now()
                  chatWritten = true
                }
                // 循环下一轮号顺延（官方 chat-history-import-service.js 同款）
                const agent = typeof ctx.get === 'function' ? ctx.get('agents')?.get?.(sid) : null
                if (agent?.phase && (agent.phase.kind === undefined || agent.phase.kind === 'idle')) {
                  agent.phase.lastTurn = Math.max(Number(agent.phase.lastTurn) || 0, turn)
                }
                if (typeof sessions.flush === 'function') {
                  try { await sessions.flush(session) } catch (e) { log('[injectGreeting] flush error: ' + e.message) }
                }
                return sendJson({ ok: true, messageId: msgId, turn, chatWritten })
              } catch (err) {
                return sendJson({ ok: false, error: String(err?.message || err) }, 400)
              }
            }
            case 'branch/unbind': {
              try {
                const sid = String(body.sessionId || '')
                if (!sid) return sendJson({ ok: false, error: '需要 sessionId' }, 400)
                const reg = readRegistry()
                const entry = reg.branches[sid]
                const fid = entry?.familyId || resolveFamilyId(sid)
                if (!fid) return sendJson({ ok: false, error: '该会话没有族谱关联' }, 400)
                if (sid === fid) return sendJson({ ok: false, error: '主线（族根）不能解除关联——族以它为键；如需拆族请用合并/解除各支线' }, 400)
                unregisterBranch(sid)
                // 双向清理【支线】条目：本会话书里来自该族的、族成员书里来自本会话的
                const removed = removeSidelineEntries(sid, familyMembers(fid).map(m => m.sessionId))
                let cleaned = 0
                for (const m of familyMembers(fid)) {
                  if (m.sessionId && m.sessionId !== sid) cleaned += removeSidelineEntries(m.sessionId, [sid])
                }
                clearFamilyCaches()
                return sendJson({ ok: true, familyId: fid, removedEntries: removed + cleaned })
              } catch (err) {
                return sendJson({ ok: false, error: String(err?.message || err) }, 400)
              }
            }
            case 'branch/bind': {
              try {
                const sid = String(body.sessionId || '')
                const parentSid = String(body.parentSid || '')
                const familyId = String(body.familyId || '').trim() || (parentSid ? rootOf(parentSid) : '')
                if (!sid || !familyId) return sendJson({ ok: false, error: '需要 sessionId 与 familyId（或 parentSid）' }, 400)
                if (!sessionAlive(sid)) return sendJson({ ok: false, error: '目标会话不存在（可能已删除）' }, 400)
                const existing = readRegistry().branches[sid]
                if (existing && existing.familyId !== familyId) return sendJson({ ok: false, error: '该会话已属于其他族（' + existing.familyId + '），请先解除关联' }, 400)
                const member = registerBranch({ sessionId: sid, familyId, parentSid: parentSid || familyId, label: body.label })
                // 加入后立即生成族内互注条目（新成员拿到族成员 LTM 副本）
                let synced = 0
                try { synced = syncSidelineEntries(sid) } catch { }
                for (const m of familyMembers(familyId)) {
                  if (m.sessionId && m.sessionId !== sid) { try { syncSidelineEntries(m.sessionId) } catch { } }
                }
                return sendJson({ ok: true, member, familyId, synced })
              } catch (err) {
                return sendJson({ ok: false, error: String(err?.message || err) }, 400)
              }
            }
            case 'branch/sync': {
              // 手动触发支线互注条目导入（不等后台结算；含 LTM + 已知情报）
              const sid = String(body.sessionId || '')
              if (!sid) return sendJson({ ok: false, error: '需要 sessionId' }, 400)
              if (!resolveFamilyId(sid)) return sendJson({ ok: false, error: '本会话没有族谱关联' }, 400)
              try {
                const synced = syncSidelineEntries(sid)
                return sendJson({ ok: true, synced })
              } catch (err) {
                return sendJson({ ok: false, error: String(err?.message || err) }, 400)
              }
            }
            case 'branch/families': {
              // 全部族列表（供合并选择）：fid + 成员摘要
              const reg = readRegistry()
              const fids = [...new Set(Object.values(reg.branches).map(b => b.familyId))]
              const families = fids.map(fid => ({ familyId: fid, members: familyMembers(fid) })).filter(f => f.members.length > 0)
              return sendJson({ ok: true, families })
            }
            case 'branch/merge': {
              try {
                const sourceFid = String(body.sourceFamilyId || '')
                const targetFid = String(body.targetFamilyId || '')
                if (!sourceFid || !targetFid) return sendJson({ ok: false, error: '需要 sourceFamilyId 与 targetFamilyId' }, 400)
                if (sourceFid === targetFid) return sendJson({ ok: false, error: '不能合并到自身' }, 400)
                const reg = readRegistry()
                const sourceBranches = Object.entries(reg.branches).filter(([, b]) => b.familyId === sourceFid)
                // 1. 源族成员全部并入目标族（保留别名/父指针）；源族根登记为普通支线
                for (const [sid, b] of sourceBranches) {
                  registerBranch({ sessionId: sid, familyId: targetFid, parentSid: b.parentSid === sourceFid ? targetFid : b.parentSid, label: b.label })
                }
                const sourceRootEntry = reg.branches[sourceFid]
                if (sessionAlive(sourceFid) && !readRegistry().branches[sourceFid]) {
                  registerBranch({ sessionId: sourceFid, familyId: targetFid, parentSid: targetFid, label: sourceRootEntry?.label || sessionTitle(sourceFid) || '原主线' })
                } else if (sessionAlive(sourceFid)) {
                  registerBranch({ sessionId: sourceFid, familyId: targetFid, parentSid: targetFid, label: reg.branches[sourceFid]?.label || '原主线' })
                }
                // 2. known_facts 已不族共享（v0.9.19），无需合并文件；清理源族遗留文件
                deleteFamilyFile(sourceFid)
                clearFamilyCaches()
                // 3. 双向刷新族内条目
                let synced = 0
                for (const m of familyMembers(targetFid)) {
                  if (m.sessionId) { try { synced += syncSidelineEntries(m.sessionId) } catch { } }
                }
                const merged = familyMembers(targetFid)
                return sendJson({ ok: true, familyId: targetFid, members: merged, synced })
              } catch (err) {
                return sendJson({ ok: false, error: String(err?.message || err) }, 400)
              }
            }
            case 'branch/rename': {
              try {
                const sid = String(body.sessionId || '')
                const label = String(body.label || '').trim()
                if (!sid || !label) return sendJson({ ok: false, error: '需要 sessionId 与 label' }, 400)
                const existing = readRegistry().branches[sid]
                const familyId = existing?.familyId || resolveFamilyId(sid) || sid // 根会话改名：familyId=自身
                const member = registerBranch({ sessionId: sid, familyId, parentSid: existing?.parentSid || '', label })
                // 别名变了 → 立即同步其他成员的【支线】条目（换新别名标记/标题），
                // 刷新族共享情报的 keywords 标记，并重生成已知情报条目；时机不严格，这里尽力即时
                let synced = 0
                // 改名会话自己的条目也刷新（自己来源的情报条目标记在其本人书中也要换新）
                try { autoImportFromAnchor(sid, readAnchor(sid)) } catch { }
                for (const m of familyMembers(familyId)) {
                  if (m.sessionId && m.sessionId !== sid) {
                    try { synced += syncSidelineEntries(m.sessionId) } catch { }
                    try { autoImportFromAnchor(m.sessionId, readAnchor(m.sessionId)) } catch { }
                  }
                }
                return sendJson({ ok: true, member, familyId, synced })
              } catch (err) {
                return sendJson({ ok: false, error: String(err?.message || err) }, 400)
              }
            }
            case 'branch/list': {
              const sid = body.sessionId
              const fid = resolveFamilyId(sid)
              const members = fid ? familyMembers(fid) : []
              return sendJson({ ok: true, familyId: fid || null, members, isRoot: fid === sid })
            }
            case 'worldbook/get': {
              const sid = body.sessionId
              const book = readSessionWorldbook(sid)
              const prepared = chat?.preparedWorldBook || null
              const anchor = readAnchor(sid) || (chat && chat.narrativeAnchor) || null
              const inCtx = new Set((Array.isArray(prepared?.refs) ? prepared.refs : []).map(r => String(r)))
              // v0.7.14：selection 可能存 'session-wb:'+id 或裸 id，都算已勾选
              const selList = Array.isArray(book?.selection) ? book.selection.map(String) : []
              const bookEntries = book ? book.entries.map(e => ({
                ...e,
                inContext: inCtx.has('session-wb:' + e.id),
                selected: selList.includes(e.id) || selList.includes('session-wb:' + e.id)
              })) : []
              // v0.7.2：官方世界书（文件直读）+ 召回审计（非侵入）
              const dataRoot = resolveTavernDataRoot(undefined, [config.tavernDataRoot].filter(Boolean))
              const official = readOfficialWorldbooks(dataRoot, chat)
              const recall = readRecallAudit(dataRoot, chat?.id)
              // v0.7.17ad：最新 reply 请求上下文分析（含工具补查 tool-result 文本）→ 条目真实在上下文标记
              let ctx = null
              let presentRefs = []
              if (dataRoot && chat?.id) {
                ctx = readLatestReplyContext(dataRoot, chat.id)
                if (ctx) {
                  const probeList = []
                  for (const e of (official?.embedded || [])) probeList.push({ ref: e.ref, entry: e })
                  for (const e of (official?.external || [])) probeList.push({ ref: e.ref, entry: e })
                  for (const e of (book?.entries || [])) probeList.push({ ref: 'session-wb:' + e.id, entry: e })
                  // v0.7.19b：绑定世界书条目也参与「在上下文」判定（bound 条目注入后 ref='bound:书序:条序'）
                  for (const e of (boundWorldbookEntries(book, dataRoot).entries || [])) probeList.push({ ref: e.ref, entry: e })
                  presentRefs = probeList.filter(p => entryPresentInContext(ctx.haystack, p.entry)).map(p => p.ref)
                  ctx.haystack = '' // 不送回前端（省流量）
                }
              }
              return sendJson({
                ok: true,
                book: book ? { ...book, entries: bookEntries } : null,
                prepared: prepared ? {
                  mode: prepared.mode, refs: prepared.refs, totalChars: prepared.totalChars,
                  contextChars: prepared.contextChars, context: chat?.preparedWorldBookContext || '',
                  turn: prepared.turn
                } : null,
                official,
                lastTurnText: ctx?.lastAssistant || '', // v0.7.17am：上一段 AI 输出（预测关键词命中文本源）
                recall: recall ? {
                  record: recall.record,
                  turn: recall.operation?.turn,
                  status: recall.operation?.status,
                  entries: Array.isArray(recall.operation?.entries) ? recall.operation.entries : [],
                  // v0.7.13：磁盘快照滞后导致 preparedWorldBook 常为空；
                  // 以审计 outputs（status=requested 即实际注入）作为"在快照"权威来源
                  outputRefs: Array.isArray(recall.operation?.outputs) ? recall.operation.outputs.map(o => o?.ref).filter(Boolean) : [],
                  // v0.7.14：冷却中条目（force 注入也不绕过冷却，页面需提示）
                  cooldownRefs: Array.isArray(recall.operation?.entries) ? recall.operation.entries.filter(x => x?.reason === 'cooldown').map(x => String(x?.ref)).filter(Boolean) : [],
                  // v0.7.15：筛选统计（官方 reason 分布 + LLM 筛选池规模）
                  // v0.7.17：上一轮强制注入（activationRequests force=true，含勾选/原生调度）
                  forcedRefs: Array.isArray(recall.operation?.activationRequests) ? recall.operation.activationRequests.filter(r => r?.force).map(r => String(r?.ref)).filter(Boolean) : [],
                  counts: recall.operation?.counts || null,
                  screening: recall.operation?.screening ? { candidateCount: recall.operation.screening.candidateCount, estimatedTokens: recall.operation.screening.estimatedTokens } : null,
                  entriesCount: Array.isArray(recall.operation?.entries) ? recall.operation.entries.length : 0
                } : null,
                dataRoot,
                bound: (() => {
                  const bd = boundWorldbookEntries(book, dataRoot)
                  return { books: bd.books, entryCount: bd.entries.length, entries: bd.entries }
                })(),
                context: ctx ? { requestId: ctx.requestId, turn: ctx.turn, ts: ctx.ts, haystackLen: ctx.haystackLen, presentRefs } : null,
                anchorCounts: anchor ? {
                  stm: (anchor.memory?.stm || []).length, ltm: (anchor.memory?.ltm || []).length,
                  known_facts: (anchor.memory?.known_facts || []).length,
                  foreshadow: (anchor.memory?.foreshadow_library || []).length
                } : null
              })
            }
            case 'worldbook/entry': {
              const sid = body.sessionId
              const book = loadSessionWorldbook(sid)
              const action = body.action
              const now = Date.now()              // v0.7.17al：官方条目（ref=entry:N）编辑/停用 → 写回卡工作副本 / 外部世界书文件
              const officialRef = action === 'toggle' ? String(body.entryId || '') : String(body.entry?.ref || '')
              if (officialRef.startsWith('entry:')) {
                const dataRoot = resolveTavernDataRoot(undefined, [config.tavernDataRoot].filter(Boolean))
                const res = updateOfficialEntry(dataRoot, chat, {
                  ref: officialRef,
                  source: body.source,
                  patch: action === 'toggle' ? { toggle: true } : {
                    enabled: typeof body.entry?.enabled === 'boolean' ? body.entry.enabled : undefined,
                    title: typeof body.entry?.title === 'string' ? body.entry.title : undefined,
                    keys: Array.isArray(body.entry?.keys) ? body.entry.keys : undefined,
                    content: typeof body.entry?.content === 'string' ? body.entry.content : undefined
                  }
                })
                if (!res.ok) return sendJson(res, 400)
                return sendJson({ ok: true, ref: officialRef, source: res.source, enabled: res.enabled, filePath: res.filePath })
              }
              // v0.7.20：bound 条目（会话绑定世界书）编辑/停用 → 写回绑定世界书文件（同官方右键菜单）
              // v0.9.19：抽到 session-worldbook.js updateBoundEntry（双格式 disable/key 语义，可单测）
              if (officialRef.startsWith('bound:')) {
                const dataRoot = resolveTavernDataRoot(undefined, [config.tavernDataRoot].filter(Boolean))
                const res = updateBoundEntry(book, officialRef, { action, entry: body.entry }, dataRoot)
                if (!res.ok) return sendJson(res, 400)
                return sendJson(res)
              }
              if (action === 'add' || action === 'update') {
                const e = body.entry || {}
                if (action === 'add') {
                  const id = 'manual-' + now.toString(36) + Math.floor(Math.random() * 1000).toString(36)
                  book.entries.push({
                    id, title: String(e.title || ''), keys: Array.isArray(e.keys) ? e.keys : [],
                    content: String(e.content || ''), enabled: e.enabled !== false, constant: e.constant === true,
                    source: 'manual', createdAt: now, updatedAt: now
                  })
                } else {
                  const target = book.entries.find(x => x.id === e.id)
                  if (!target) return sendJson({ ok: false, error: '条目不存在: ' + e.id }, 404)
                  if (typeof e.title === 'string') target.title = e.title
                  if (Array.isArray(e.keys)) target.keys = e.keys
                  if (typeof e.content === 'string') target.content = e.content
                  if (typeof e.enabled === 'boolean') { target.enabled = e.enabled; target.enabledTouched = true }
                  if (typeof e.constant === 'boolean') target.constant = e.constant
                  target.updatedAt = now

                  // 反向同步：如果该条目是从 known_facts 自动生成的，把修改后的 content 同步回 known_facts.summary
                  // 解析方式：去掉第一行标题（titleLine），剩下的全部作为 summary
                  if (target.anchorRef && target.anchorRef.kind === 'known_fact' && typeof e.content === 'string') {
                    try {
                      const kfId = target.anchorRef.id
                      const anchor = readAnchor(sid)
                      if (anchor && Array.isArray(anchor.memory?.known_facts)) {
                        const kfIdx = anchor.memory.known_facts.findIndex(f => f.id === kfId)
                        if (kfIdx >= 0) {
                          // 去掉第一行标题（仅在创建时写入的 titleLine），剩下的作为 summary
                          const lines = String(e.content).split('\n')
                          const summary = lines.slice(1).join('\n').trim()
                          if (summary) {
                            anchor.memory.known_facts[kfIdx].summary = summary
                            // 移到末尾（和 LLM 提交的合并逻辑保持一致）
                            const [item] = anchor.memory.known_facts.splice(kfIdx, 1)
                            anchor.memory.known_facts.push(item)
                            writeAnchor(sid, anchor)
                          }
                        }
                      }
                    } catch (err) {
                      // 反向同步失败不阻塞世界书条目更新
                      console.error('[narrative-anchor] 反向同步 known_facts 失败:', err)
                    }
                  }
                }
              } else if (action === 'delete') {
                book.entries = book.entries.filter(x => x.id !== body.entryId)
                book.selection = book.selection.filter(x => x !== body.entryId && x !== 'session-wb:' + body.entryId)
              } else if (action === 'toggle') {
                const target = book.entries.find(x => x.id === body.entryId)
                if (target) { target.enabled = target.enabled === false; target.enabledTouched = true }
              } else return sendJson({ ok: false, error: '未知 action: ' + action }, 400)
              writeSessionWorldbook(book)
              return sendJson({ ok: true, book })
            }
            case 'worldbook/entries-clear': {
              // 批量删除临时条目（按 id 列表；客户端按当前筛选传 ids）——条目与强制注入选择一并清理
              const sid = body.sessionId
              const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(String))
              if (ids.size === 0) return sendJson({ ok: false, error: '需要 ids' }, 400)
              const book = loadSessionWorldbook(sid)
              const before = book.entries.length
              book.entries = book.entries.filter(x => !ids.has(String(x.id)))
              const removed = before - book.entries.length
              book.selection = book.selection.filter(x => !ids.has(String(x)) && !ids.has(String(x).replace(/^session-wb:/, '')))
              writeSessionWorldbook(book)
              return sendJson({ ok: true, removed })
            }
            case 'worldbook/history': {
              const dataRoot = resolveTavernDataRoot()
              const chatId = (String(chat?.id || '').startsWith('chat-') ? chat.id : chat?.chatId) || readChatFromDisk(dataRoot, body.sessionId)?.id || (body.chatId || '')
              const history = dataRoot && chatId ? readRecallHistory(dataRoot, chatId, Number(body.limit) || 12) : []
              return sendJson({ ok: true, history })
            }
            case 'worldbook/library': {
              const dataRootLib = resolveTavernDataRoot(undefined, [config.tavernDataRoot].filter(Boolean))
              const standalone = []
              const embedded = []
              if (dataRootLib) {
                const { readdirSync: _rd, readFileSync: _rf, existsSync: _ex } = await import('node:fs')
                const { join: _jn } = await import('node:path')
                const wbDir = _jn(dataRootLib, 'resources', 'worldbooks')
                if (_ex(wbDir)) {
                  for (const f of _rd(wbDir).filter(n => /.json$/i.test(n))) {
                    try {
                      const doc = JSON.parse(_rf(_jn(wbDir, f), 'utf-8'))
                      const list = doc?.character_book?.entries || doc?.entries || doc?.data?.character_book?.entries
                      const listArr = Array.isArray(list) ? list : (list && typeof list === 'object' ? Object.values(list) : [])
                      standalone.push({
                        path: 'worldbooks/' + f,
                        name: String(doc?.name || doc?.data?.name || doc?.character_book?.name || f.replace(/\.json$/, '')),
                        entryCount: listArr.length,
                        enabledCount: listArr.filter(e => e?.enabled !== false).length
                      })
                    } catch { /* 跳过损坏文件 */ }
                  }
                }
                const cardDir = _jn(dataRootLib, 'resources', 'cards')
                if (_ex(cardDir)) {
                  for (const f of _rd(cardDir).filter(n => /.json$/i.test(n))) {
                    try {
                      const ws = JSON.parse(_rf(_jn(cardDir, f), 'utf-8'))
                      const raw = ws?.raw || ws
                      const cb = raw?.data?.character_book || raw?.character_book
                      if (!cb || typeof cb !== 'object') continue
                      const list = cb.entries
                      const listArr = Array.isArray(list) ? list : (list && typeof list === 'object' ? Object.values(list) : [])
                      embedded.push({
                        cardPath: 'cards/' + f,
                        cardName: String(raw?.data?.name || raw?.name || f.replace(/\.json$/, '')),
                        name: String(cb?.name || raw?.data?.name || f.replace(/\.json$/, '')),
                        entryCount: listArr.length,
                        enabledCount: listArr.filter(e => e?.enabled !== false).length
                      })
                    } catch { /* 跳过损坏文件 */ }
                  }
                }
              }
              return sendJson({ ok: true, standalone, embedded })
            }
            case 'worldbook/bind': {
              const sid = body.sessionId
              const book = loadSessionWorldbook(sid)
              const action = body.action || 'add'
              const sources = Array.isArray(body.books) ? body.books : []
              const now = Date.now()
              const norm = sources.map(src => {
                if (src?.kind === 'embedded') return { kind: 'embedded', cardPath: String(src.cardPath || '') }
                return { kind: 'standalone', path: String(src?.path || '') }
              }).filter(s => (s.kind === 'embedded' && s.cardPath) || (s.kind === 'standalone' && s.path))
              const current = Array.isArray(book.boundBooks) ? book.boundBooks : []
              const unboundG = Array.isArray(book.unboundGlobals) ? book.unboundGlobals : []
              const globalKeys = new Set(listGlobalAutoBind().map(sourceSig))
              if (action === 'set') {
                book.boundBooks = norm
                // set/replace 只管本会话本地绑定；重新绑定的来源同时撤销其"主动解除"记录
                const keys = new Set(norm.map(sourceSig))
                book.unboundGlobals = unboundG.filter(s => !keys.has(sourceSig(s)))
              } else if (action === 'remove') {
                const keys = new Set(norm.map(sourceSig))
                book.boundBooks = current.filter(s => !keys.has(sourceSig(s)))
                // v0.9.15：解除全局自动绑定的来源 → 记入本会话主动解除清单（带 ts，
                // 与全局条目 ts 比较：解除晚于设为全局才生效）
                book.unboundGlobals = [
                  ...unboundG.filter(s => !keys.has(sourceSig(s))),
                  ...norm.filter(s => globalKeys.has(sourceSig(s)) && !unboundG.some(u => sourceSig(u) === sourceSig(s)))
                    .map(s => ({ ...s, ts: now }))
                ]
              } else { // add
                const keys = new Set(current.map(sourceSig))
                for (const s of norm) {
                  if (!keys.has(sourceSig(s))) { current.push(s); keys.add(sourceSig(s)) }
                }
                book.boundBooks = current
                // add 的来源若之前被主动解除 → 恢复跟随（撤销解除记录）
                const addKeys = new Set(norm.map(sourceSig))
                book.unboundGlobals = unboundG.filter(s => !addKeys.has(sourceSig(s)))
              }
              book.updatedAt = now
              writeSessionWorldbook(book)
              const bd = boundWorldbookEntries(book, resolveTavernDataRoot(undefined, [config.tavernDataRoot].filter(Boolean)))
              return sendJson({ ok: true, boundBooks: effectiveBoundBooks(book), unboundGlobals: book.unboundGlobals, books: bd.books, entryCount: bd.entries.length })
            }
            // v0.9.15：全局自动绑定清单管理（新会话/分支会话自动跟随）
            case 'worldbook/global-bind': {
              const action = body.action || 'list'
              try {
                if (action === 'list') return sendJson({ ok: true, globalAutoBind: listGlobalAutoBind() })
                if (action === 'set') {
                  const list = setGlobalAutoBind(Array.isArray(body.books) ? body.books : [])
                  // 新 ts 自动覆盖所有更早的会话解除记录，无需清扫
                  return sendJson({ ok: true, globalAutoBind: list })
                }
                if (action === 'toggle') {
                  const list = toggleGlobalAutoBind(body.book)
                  return sendJson({ ok: true, globalAutoBind: list })
                }
                return sendJson({ ok: false, error: '未知 action: ' + action }, 400)
              } catch (err) {
                return sendJson({ ok: false, error: String(err?.message || err) }, 400)
              }
            }
            case 'worldbook/combos': {
              const action = body.action || 'list'
              try {
                if (action === 'list') return sendJson({ ok: true, combos: listCombos(), globalAutoBind: listGlobalAutoBind() })
                if (action === 'create') {
                  const combo = createCombo(body.name, body.books)
                  return sendJson({ ok: true, combo, combos: listCombos() })
                }
                if (action === 'update') {
                  const combo = updateCombo(body.id, { name: body.name, books: body.books })
                  return sendJson({ ok: true, combo, combos: listCombos() })
                }
                if (action === 'delete') {
                  deleteCombo(body.id)
                  return sendJson({ ok: true, id: body.id, combos: listCombos() })
                }
                if (action === 'addBooks') {
                  const combos = listCombos()
                  const combo = combos.find(c => c.id === body.id)
                  if (!combo) return sendJson({ ok: false, error: '组合不存在: ' + body.id }, 404)
                  const add = (Array.isArray(body.books) ? body.books : []).map(src =>
                    src?.kind === 'embedded'
                      ? { kind: 'embedded', cardPath: String(src.cardPath || '') }
                      : { kind: 'standalone', path: String(src?.path || '') })
                    .filter(s => (s.kind === 'embedded' && s.cardPath) || (s.kind === 'standalone' && s.path))
                  if (add.length === 0) return sendJson({ ok: false, error: '没有可加入的世界书' }, 400)
                  const sig = (sb) => (sb.kind === 'embedded' ? 'e:' + sb.cardPath : 's:' + sb.path)
                  const seen = new Set((combo.books || []).map(sig))
                  const merged = [...(combo.books || []), ...add.filter(sb => !seen.has(sig(sb)))]
                  const updated = updateCombo(body.id, { books: merged })
                  return sendJson({ ok: true, combo: updated, combos: listCombos() })
                }
                if (action === 'removeBook') {
                  const combos = listCombos()
                  const combo = combos.find(c => c.id === body.id)
                  if (!combo) return sendJson({ ok: false, error: '组合不存在: ' + body.id }, 404)
                  const idx = Number(body.bookIndex)
                  if (!Number.isInteger(idx) || idx < 0 || idx >= (combo.books || []).length) {
                    return sendJson({ ok: false, error: '无效的世界书索引: ' + body.bookIndex }, 400)
                  }
                  const books = (combo.books || []).filter((_, i) => i !== idx)
                  const updated = updateCombo(body.id, { books })
                  return sendJson({ ok: true, combo: updated, combos: listCombos() })
                }
                if (action === 'apply') {
                  const combos = listCombos()
                  const combo = combos.find(c => c.id === body.id)
                  if (!combo) return sendJson({ ok: false, error: '组合不存在: ' + body.id }, 404)
                  const sid = body.sessionId
                  const book = loadSessionWorldbook(sid)
                  const mode = body.mode === 'merge' ? 'merge' : 'replace'
                  const sig = (s) => (s.kind === 'embedded' ? 'e:' + s.cardPath : 's:' + s.path)
                  const existing = new Set((book.boundBooks || []).map(sig))
                  book.boundBooks = mode === 'merge'
                    ? [...(book.boundBooks || []), ...combo.books.filter(s => !existing.has(sig(s)))]
                    : combo.books.map(s => ({ ...s }))
                  book.updatedAt = Date.now()
                  writeSessionWorldbook(book)
                  const bd = boundWorldbookEntries(book, resolveTavernDataRoot(undefined, [config.tavernDataRoot].filter(Boolean)))
                  return sendJson({ ok: true, applied: combo.id, boundBooks: book.boundBooks, books: bd.books, entryCount: bd.entries.length })
                }
                return sendJson({ ok: false, error: '未知 action: ' + action }, 400)
              } catch (err) {
                return sendJson({ ok: false, error: String(err?.message || err) }, 400)
              }
            }
            case 'worldbook/select': {
              const sid = body.sessionId
              const book = loadSessionWorldbook(sid)
              if (body.clear === true) book.selection = []
              else book.selection = Array.isArray(body.entryIds)
                ? body.entryIds.filter(id => book.entries.some(e => e.id === id) || String(id).startsWith('entry:') || String(id).startsWith('session-wb:') || String(id).startsWith('bound:'))
                : book.selection
              writeSessionWorldbook(book)
              return sendJson({ ok: true, selection: book.selection, book })
            }
            case 'worldbook/settings': {
              const sid = body.sessionId
              const book = loadSessionWorldbook(sid)
              if (typeof body.enabled === 'boolean') book.enabled = body.enabled
              if (typeof body.autoFromAnchor === 'boolean') book.autoFromAnchor = body.autoFromAnchor
              if (body.anchorAuto && typeof body.anchorAuto === 'object') {
                book.anchorAuto = { ...(book.anchorAuto || {}), ...body.anchorAuto }
                if (typeof book.anchorAuto.maxEnabled === 'number') book.anchorAuto.maxEnabled = Math.max(1, Math.min(1000, Math.floor(book.anchorAuto.maxEnabled)))
              }
              // v0.7.4：先写设置，再执行导入（autoImportFromAnchor 内部写文件），
              // 避免 L764 旧 book 覆盖掉导入修改；返回时重读最新。
              writeSessionWorldbook(book)
              if (body.importNow === true) {
                const anchor = readAnchor(sid) || (chat && chat.narrativeAnchor) || null
                if (anchor) autoImportFromAnchor(sid, anchor, true)
              }
              const finalBook = readSessionWorldbook(sid) || book
              return sendJson({ ok: true, book: finalBook })
            }
                  default:
        return { ok: false, error: '未知方法: ' + method }
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}
