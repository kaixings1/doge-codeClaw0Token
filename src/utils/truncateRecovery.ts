/**
 * 截断恢复机制
 * 在截断后向模型说明上下文变化
 */

import { createUserMessage } from './messages.js'
import type { Message } from '../types/message.js'

/**
 * 创建截断说明消息
 */
export function createTruncateRecoveryMessage(
  removedMessages: number,
  freedTokens: number,
  reason: string,
): Message {
  return createUserMessage({
    content: [
      {
        type: 'text',
        text: `\n[系统说明]\n- 上下文已精简：删除了 ${removedMessages} 条消息\n- 释放了 ${freedTokens.toLocaleString()} tokens\n- 原因：${reason}\n- 请继续处理当前任务\n`,
      },
    ],
    isMeta: true,
  })
}

/**
 * 检查截断频率
 */
export function checkTruncateFrequency(
  lastTruncateAt: number,
  currentTimestamp: number,
  minInterval: number = 60000,  // 1 分钟
): {
  canTruncate: boolean
  waitTime: number
  reason: string
} {
  const elapsed = currentTimestamp - lastTruncateAt
  const waitTime = minInterval - elapsed

  if (elapsed < minInterval) {
    return {
      canTruncate: false,
      waitTime: Math.ceil(waitTime / 1000),
      reason: `需要等待 ${waitTime / 1000} 秒`,
    }
  }

  // 检查截断频率是否过高（超过 0.1 次/秒）
  const truncateRate = truncateEventHistory.length / ((elapsed / 1000) || 1)
  if (truncateRate > 0.1) {
    return {
      canTruncate: false,
      waitTime: 0,
      reason: `截断频率过高 (${truncateRate.toFixed(2)} 次/秒)`,
    }
  }

  return {
    canTruncate: true,
    waitTime: 0,
    reason: '可以截断',
  }
}

/**
 * 记录截断事件
 */
export interface TruncateEvent {
  timestamp: number
  removedCount: number
  freedTokens: number
  reason: string
  priorityScore: number
}

export const truncateEventHistory: TruncateEvent[] = []

export function recordTruncateEvent(
  event: TruncateEvent,
  maxSize: number = 100,
): void {
  truncateEventHistory.push(event)
  if (truncateEventHistory.length > maxSize) {
    truncateEventHistory.shift()
  }
}

export function getTruncateStats(
  windowSize: number = 60,  // 最近 60 次截断
): {
  totalRemoved: number
  totalFreedTokens: number
  avgPriorityScore: number
  lastReason: string
} {
  const recentEvents = truncateEventHistory.slice(-windowSize)
  const totalRemoved = recentEvents.reduce((sum, e) => sum + e.removedCount, 0)
  const totalFreedTokens = recentEvents.reduce((sum, e) => sum + e.freedTokens, 0)
  const avgPriorityScore =
    recentEvents.length > 0
      ? recentEvents.reduce((sum, e) => sum + e.priorityScore, 0) / recentEvents.length
      : 0

  return {
    totalRemoved,
    totalFreedTokens,
    avgPriorityScore,
    lastReason: recentEvents[recentEvents.length - 1]?.reason ?? '无',
  }
}
