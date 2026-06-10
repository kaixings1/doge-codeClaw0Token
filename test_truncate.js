// 截断功能测试脚本

console.log('=== 上下文截断功能测试 ===\n')

// 模拟环境变量
process.env.CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES = '30'
process.env.CLAUDE_KEEP_LAST_MESSAGES = '15'
process.env.CLAUDE_TRUNCATE_WARN_THRESHOLD = '2500'

// 导入模块
const { truncateMessages, shouldTruncate } = require('./src/services/compact/truncateContext.js')

// 测试数据
const testMessages = [
  { type: 'system', message: { content: [{ type: 'text', text: '系统提示' }] } },
  { type: 'user', message: { content: [{ type: 'text', text: '用户消息 1' }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: '助手回复 1' }] } },
  // ... 更多消息 ...
]

// 测试 1: 检查是否需要截断
console.log('测试 1: 检查截断需求')
const truncateResult = shouldTruncate(testMessages)
console.log('  needTruncate:', truncateResult.needTruncate)
console.log('  reason:', truncateResult.reason)
console.log('  priorityScore:', truncateResult.priorityScore.toFixed(2))

// 测试 2: 执行截断
console.log('\n测试 2: 执行截断')
const truncated = truncateMessages(testMessages)
console.log('  原始消息数:', testMessages.length)
console.log('  截断后消息数:', truncated.messages.length)
console.log('  freedTokens:', truncated.freedTokens)
console.log('  removedTypes:', truncated.removedTypes)
console.log('  priorityScore:', truncated.priorityScore.toFixed(2))

console.log('\n=== 测试完成 ===')
