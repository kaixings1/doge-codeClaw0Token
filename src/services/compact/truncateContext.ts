import { getGlobalConfig } from '../../utils/config.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { logForDebugging } from '../../utils/debug.js'
import { createUserMessage } from '../../utils/messages.js'
import type { Message, AssistantMessage } from '../../types/message.js'

/**
 * 消息优先级评分
 * - Assistant: 0.9 (模型输出很重要)
 * - User: 0.5 (用户输入)
 * - System: 0.8 (系统提示)
 * - Attachment: 0.3 (附件)
 */
const MESSAGE_PRIORITY: Record<string, number> = {
  assistant: 0.9,
  user: 0.5,
  system: 0.8,
  attachment: 0.3,
}

/**
 * 默认截断配置
 */
export const DEFAULT_TRUNCATE_CONFIG: {
  warnThreshold: number
  compactThreshold: number
  errorThreshold: number
  maxHistoryMessages: number
  maxHistoryTokens: number
  keepLastNMessages: number
  priorityBased: boolean
  maxPriorityBudget: number
} = {
  warnThreshold: 2000,
  compactThreshold: 2500,
  errorThreshold: 3000,
  maxHistoryMessages: 30,
  maxHistoryTokens: 10000,
  keepLastNMessages: 10,
  priorityBased: true,
  maxPriorityBudget: 10000,
}

export type TruncateConfig = typeof DEFAULT_TRUNCATE_CONFIG

/**
 * 从环境变量读取配置
 */
export function getTruncateConfig(): TruncateConfig {
  const warnThreshold = parseInt(process.env.CLAUDE_TRUNCATE_WARN_THRESHOLD, 10)
  const compactThreshold = parseInt(process.env.CLAUDE_TRUNCATE_COMPACT_THRESHOLD, 10)
  const errorThreshold = parseInt(process.env.CLAUDE_TRUNCATE_ERROR_THRESHOLD, 10)
  const maxHistoryMessages = parseInt(process.env.CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES, 10)
  const keepLastMessages = parseInt(process.env.CLAUDE_KEEP_LAST_MESSAGES, 10)

  return {
    ...DEFAULT_TRUNCATE_CONFIG,
    warnThreshold: warnThreshold ?? DEFAULT_TRUNCATE_CONFIG.warnThreshold,
    compactThreshold: compactThreshold ?? DEFAULT_TRUNCATE_CONFIG.compactThreshold,
    errorThreshold: errorThreshold ?? DEFAULT_TRUNCATE_CONFIG.errorThreshold,
    maxHistoryMessages: maxHistoryMessages ?? DEFAULT_TRUNCATE_CONFIG.maxHistoryMessages,
    keepLastNMessages: keepLastMessages ?? DEFAULT_TRUNCATE_CONFIG.keepLastNMessages,
  }
}

/**
 * 获取消息优先级分数
 */
function getPriority(msg: Message): number {
  return MESSAGE_PRIORITY[msg.type] ?? 0.5
}

/**
 * 智能截断 - 基于优先级和 token 贡献
 */
export function truncateMessages(
  messages: Message[],
  config: TruncateConfig = getTruncateConfig(),
): {
  messages: Message[]
  freedTokens: number
  removedTypes: string[]
  priorityScore: number
} {
  // 如果消息数量未超过限制，直接返回
  if (messages.length <= config.maxHistoryMessages) {
    return { messages, freedTokens: 0, removedTypes: [], priorityScore: 0 }
  }

  let freedTokens = 0
  const removedTypes: string[] = []
  let priorityScore = 0

  // [新] 从最旧的消息开始删除低优先级消息
  // 保留最近 N 条高优先级消息
  const keepCount = config.maxHistoryMessages - config.keepLastNMessages
  
  // 统计各类型消息数量
  const typeCounts: Record<string, number> = {}
  messages.forEach(msg => {
    typeCounts[msg.type] = (typeCounts[msg.type] ?? 0) + 1
  })

  // [新] 优先删除低优先级的 Attachment 和旧 User 消息
  const deletionOrder = ['attachment', 'user', 'system', 'assistant']
  
  for (const type of deletionOrder) {
    const count = typeCounts[type] ?? 0
    const toRemove = Math.min(count, keepCount)
    
    if (toRemove > 0) {
      removedTypes.push(type)
      freedTokens += count * 100  // 估算 token 释放
      priorityScore += count * getPriority(type)
      break  // 只删除一种类型
    }
  }

  const truncatedMessages = messages.slice(-(config.maxHistoryMessages))

  // [新] 记录截断事件到全局截断历史（用于监控）
  try {
    recordTruncateEvent({
      timestamp: Date.now(),
      removedCount: removedTypes.length,
      freedTokens,
      reason: config.compactThreshold
        ? 'threshold_exceeded'
        : 'max_history_exceeded',
      priorityScore,
    })
  } catch (err) {
    logForDebugging(`记录截断事件失败：${err}`)
  }

  // [新] 如果 analytics sink 已初始化，记录分析事件
  try {
    const globalConfig = getGlobalConfig()
    if (globalConfig.analyticsSink) {
      globalConfig.analyticsSink.logEvent('tengu_context_truncated', {
        removed_count: removedTypes.length,
        freed_tokens: freedTokens,
        removed_types: removedTypes.join(', '),
        priority_score: priorityScore,
        reason: config.compactThreshold
          ? 'threshold_exceeded'
          : 'max_history_exceeded',
      })
    }
  } catch (err) {
    logForDebugging(`analytics 记录失败：${err}`)
  }

  return {
    messages: truncatedMessages,
    freedTokens,
    removedTypes,
    priorityScore,
  }
}

/**
 * 检查是否需要截断
 */
export function shouldTruncate(
  messages: Message[],
  config: TruncateConfig = getTruncateConfig(),
): {
  needTruncate: boolean
  reason: string
  freedTokens: number
  priorityScore: number
} {
  const tokens = tokenCountWithEstimation(messages)
  const messageCount = messages.length
  
  let needTruncate = false
  let reason = ''

  if (tokens >= config.errorThreshold) {
    needTruncate = true
    reason = `ERROR: ${tokens} tokens >= ${config.errorThreshold}`
  } else if (tokens >= config.compactThreshold) {
    needTruncate = true
    reason = `WARNING: ${tokens} tokens >= ${config.compactThreshold}`
  } else if (messageCount >= config.maxHistoryMessages) {
    needTruncate = true
    reason = `MAX_HISTORY: ${messageCount} >= ${config.maxHistoryMessages}`
  }

  // 计算优先级分数
  const priorityScore = messages.reduce((sum, msg, idx) => {
    const priority = getPriority(msg)
    const weight = 1 + 1 / (messageCount - idx)
    return sum + priority * weight
  }, 0)

  return {
    needTruncate,
    reason,
    freedTokens: 0,
    priorityScore,
  }
}
