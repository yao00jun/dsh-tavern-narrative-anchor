/**
 * 叙事锚定 —— 本地数据持久化存储与快照日志
 *
 * 存储位置：<插件目录>/data/anchors/<sessionId>.json
 * 配合 ctx.tavern.saveTurnData / readTurnData 提供统一存储层与双重持久化
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const anchorsDir = join(here, '..', 'data', 'anchors')

function ensureDir() {
  try { mkdirSync(anchorsDir, { recursive: true }) } catch { /* 忽略 */ }
}

function fileFor(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^\w-]/g, '_')
  return join(anchorsDir, safe + '.json')
}

export function writeAnchor(sessionId, anchor) {
  try {
    ensureDir()
    writeFileSync(fileFor(sessionId), JSON.stringify(anchor, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}

export function readAnchor(sessionId) {
  try {
    const file = fileFor(sessionId)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

function snapshotFileFor(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^\w-]/g, '_')
  return join(anchorsDir, 'snapshots-' + safe + '.json')
}

export function readSnapshotLog(sessionId) {
  try {
    const file = snapshotFileFor(sessionId)
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e === 'object' && Number.isSafeInteger(Number(e.turn))) : []
  } catch {
    return []
  }
}

export function writeSnapshotLog(sessionId, log) {
  try {
    ensureDir()
    writeFileSync(snapshotFileFor(sessionId), JSON.stringify(log, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}
