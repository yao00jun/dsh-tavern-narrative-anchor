/**
 * 叙事锚定独立结算路线 —— MVU 变量审计辅助（v0.5）
 *
 * 说明：本文件复刻官方 mvu-background-settlement.js 闭包内的审计/回执辅助逻辑
 * （官方未导出这些内部函数）。独立路线不调用官方 settleVariables 流程，
 * 但变量结算仍须产出与官方同构的 audit / receipt，保证下游落库兼容。
 * 官方文件更新后，若其审计语义变化，需同步本文件。
 */

export function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

export function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** 面向 Agent 的变量快照展示（隐藏内部 schema 之外敏感字段的官方口径）。 */
export function promptVariables(value) {
  return clone(object(value))
}

export function retryPromptState(variables, initialSchema) {
  return {
    currentVariables: promptVariables(variables),
    variableSchema: clone(object(initialSchema))
  }
}

function pointerSegment(value) {
  const text = str(value)
  return text === '' ? text : text.replace(/~1/g, '/').replace(/~0/g, '~')
}

function displayValue(value) {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}

function diffValues(before, after, path = '', result = []) {
  const left = object(before)
  const right = object(after)
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  for (const key of keys) {
    const next = path === '' ? key : path + '/' + key
    const beforeValue = left[key]
    const afterValue = right[key]
    if (sameValue(beforeValue, afterValue)) continue
    if (Array.isArray(beforeValue) && Array.isArray(afterValue)) {
      const length = Math.max(beforeValue.length, afterValue.length)
      const arrayKeys = Array.from({ length }, (_, index) => String(index))
      for (const arrayKey of arrayKeys) {
        const arrayPath = next + '/' + arrayKey
        const bv = beforeValue[arrayKey]
        const av = afterValue[arrayKey]
        if (sameValue(bv, av)) continue
        if (bv !== null && typeof bv === 'object' && av !== null && typeof av === 'object') {
          diffValues(bv, av, arrayPath, result)
        } else {
          result.push({ path: arrayPath, before: displayValue(bv), after: displayValue(av) })
        }
      }
      continue
    }
    if (beforeValue !== null && typeof beforeValue === 'object' && afterValue !== null && typeof afterValue === 'object') {
      diffValues(beforeValue, afterValue, next, result)
    } else {
      result.push({ path: next, before: displayValue(beforeValue), after: displayValue(afterValue) })
    }
  }
  return result
}

function pointerSegments(pointer) {
  return str(pointer).split('/').slice(1).map(pointerSegment)
}

function variablesPointer(pointer) {
  return str(pointer).replace(/^\//, '')
}

function valueAtPointer(value, pointer) {
  let current = value
  for (const segment of pointerSegments(pointer)) {
    if (current === undefined || current === null) return undefined
    if (Array.isArray(current)) current = current[Number(segment)]
    else current = current[segment]
  }
  return current
}

function pathsOverlap(left, right) {
  // diffValues 产出的变更路径无前导斜杠（stat_data/时间），而操作路径带前导斜杠
  // （/stat_data/时间）；pointerSegments 假定前导斜杠会误删首段，这里统一剥掉再比。
  const a = str(left).replace(/^\//, '').split('/').map(pointerSegment)
  const b = str(right).replace(/^\//, '').split('/').map(pointerSegment)
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) return false
  }
  return true
}

/** MVU 自身的回执镜像层（display_data/delta_data），不算玩法副作用。 */
function isMvuMirrorPath(path) {
  return /^(\/?)(display_data|delta_data)(\/|$)/.test(str(path))
}

function operationPointers(operation) {
  const pointers = [operation.path]
  if (operation.op === 'move') pointers.push(operation.from)
  return pointers
}

function operationNeedsMutation(operation, before) {
  switch (operation.op) {
    case 'insert':
    case 'add':
    case 'remove':
      return true
    case 'replace':
    case 'delta':
      return !sameValue(valueAtPointer(before, operation.path), operation.value)
    case 'move':
      return !sameValue(valueAtPointer(before, operation.path), valueAtPointer(before, operation.from))
    default:
      return true
  }
}

/** 审计变量结算：区分"声称的变更"与"副作用变更"，返回 changes/sideEffects/failures。 */
export function auditMvuSettlement(before, after, operations) {
  const allChanges = diffValues(before, after)
  const claims = Array.isArray(operations) ? operations : []
  // claimedByOp[i] = 第 i 个操作匹配到的 allChanges 索引（-1 = 未匹配）。
  // 注意 allChanges 索引与 claims 索引是两个序列，此前 failures 过滤拿操作
  // 索引去查变更索引集合，序列错位导致"写入成功仍误报未反映"。
  const claimedByOp = claims.map((operation) => {
    const pointers = operationPointers(operation)
    return allChanges.findIndex((change) => pointers.some((pointer) => pathsOverlap(change.path, pointer)))
  })
  const claimedChanges = claimedByOp.filter((index) => index >= 0)
  return {
    changes: allChanges.filter((_change, index) => claimedChanges.includes(index)),
    sideEffects: allChanges.filter((_change, index) => !claimedChanges.includes(index) && !isMvuMirrorPath(_change.path)),
    failures: claims
      .map((operation, index) => ({ operation, matched: claimedByOp[index] >= 0 }))
      .filter(({ operation, matched }) => !matched && operationNeedsMutation(operation, before))
      .map(({ operation }) => ({
        path: operation.path,
        message: '变量结算未反映声明的操作: ' + operation.op + ' ' + operation.path
      }))
  }
}

/**
 * 提交路径预检（v0.9.26）：stat_data 之外的路径（根级 delta_data/display_data 或上游
 * 社区格式的"旧->新"字符串值）即使被运行时写进变量树也不产生有效状态更新，历史
 * 上两次造成"回执报已更新而 stat_data 纹丝未动"的假结算。这里在调用运行时前直接
 * 判失败，让结算重试引导模型改用 /stat_data/* 路径。
 */
export function rejectNonStatDataPaths(operations) {
  const claims = Array.isArray(operations) ? operations : []
  return claims
    .filter((operation) => operation && typeof operation.path === 'string')
    .filter((operation) => !/\/stat_data(\/|$)/.test(operation.path))
    .map((operation) => ({
      path: operation.path,
      message: '路径必须在 stat_data 之下（以 /stat_data/ 开头）: ' + operation.op + ' ' + operation.path +
        '；值用 valueJson 提交 JSON 编码的真实值，禁止"旧值->新值"比较字符串'
    }))
}

/** 执行器未就绪/忙/领取超时时的 pending 回执（与官方文案一致）。 */
export function pendingReceipt(applied, diagnosticId) {
  const reasons = {
    'claim-timeout': '任务领取超时，变量操作已保存，等待重新投递；无需反复重载 MVU。',
    'runtime-busy': '执行器正在处理其他任务，变量操作已保存，等待空闲后继续。',
    'runtime-not-ready': 'MVU 执行器尚未就绪，变量操作已保存，就绪后自动继续。',
    'delivery-interrupted': '任务投递中断，变量操作已保存，等待重新投递。'
  }
  const deferredReason = Object.hasOwn(reasons, applied.deferredReason) ? applied.deferredReason : 'runtime-not-ready'
  return { version: 1, status: 'pending', deferredReason, summary: reasons[deferredReason], diagnosticId, changes: [], sideEffects: [], failures: [] }
}

/** 应用一次变量提交（复用官方 runtime.settleMvuUpdate 执行器），产出同构回执。 */
export async function applyMvuSubmission(input, frame, submission, diagnosticId, official) {
  if (input.onSubmission) await input.onSubmission(clone(submission))
  const applied = await input.runtime.settleMvuUpdate({
    durable: Boolean(input.onSubmission), signal: input.signal,
    operationId: input.operationId,
    chatId: input.chatId, branchId: input.branchId, basedOnRevision: input.basedOnRevision,
    sessionId: input.sessionId, messageId: input.messageId, swipeId: input.swipeId,
    expectedLifecycleRevision: input.expectedLifecycleRevision, diagnosticId,
    baselineVariables: input.currentVariables,
    preserveForeground: input.preserveForeground === true,
    storyText: frame.foregroundOutput.storyText,
    command: official.formatMvuUpdateCommand(submission),
    validate: ({ before, after }) => {
      const audit = auditMvuSettlement(before, after, submission.operations)
      const rejected = rejectNonStatDataPaths(submission.operations)
      return {
        changes: rejected.length ? [] : audit.changes,
        sideEffects: rejected.length ? [] : audit.sideEffects,
        failures: [...rejected, ...audit.failures]
      }
    }
  })
  if (applied.deferred === true || applied.stale === true) return { applied }
  const projected = applied.context?.messages?.[input.messageId]
  const after = clone(projected?.variables || {})
  const audit = applied.validation || auditMvuSettlement(input.currentVariables, after, submission.operations)
  const rolledBack = applied.rejected === true
  const changes = rolledBack ? [] : audit.changes
  const sideEffects = rolledBack ? [] : audit.sideEffects
  const status = audit.failures.length > 0
    ? (changes.length > 0 ? 'partial' : 'error')
    : (changes.length > 0 ? 'updated' : 'unchanged')
  return { applied, after, audit, rolledBack, changes, sideEffects, status, effect: applied.effect }
}
