// 测试截断环境变量

import { getGlobalConfig } from './src/utils/config.js'

// 模拟环境变量
process.env.CLAUDE_TRUNCATE_WARN_THRESHOLD = '2500'
process.env.CLAUDE_TRUNCATE_COMPACT_THRESHOLD = '3000'
process.env.CLAUDE_TRUNCATE_ERROR_THRESHOLD = '3500'
process.env.CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES = '30'
process.env.CLAUDE_KEEP_LAST_MESSAGES = '15'

console.log('测试截断环境变量配置:')
console.log('========================')

// 读取全局配置
const config = getGlobalConfig()

console.log('全局配置:')
console.log('- warnThreshold:', config.truncate.warnThreshold)
console.log('- compactThreshold:', config.truncate.compactThreshold)
console.log('- errorThreshold:', config.truncate.errorThreshold)
console.log('- maxHistoryMessages:', config.truncate.maxHistoryMessages)
console.log('- keepLastMessages:', config.truncate.keepLastMessages)

// 验证环境变量是否生效
const expected = {
  warnThreshold: 2500,
  compactThreshold: 3000,
  errorThreshold: 3500,
  maxHistoryMessages: 30,
  keepLastMessages: 15,
}

if (config.truncate.warnThreshold === expected.warnThreshold &&
    config.truncate.compactThreshold === expected.compactThreshold &&
    config.truncate.errorThreshold === expected.errorThreshold &&
    config.truncate.maxHistoryMessages === expected.maxHistoryMessages &&
    config.truncate.keepLastMessages === expected.keepLastMessages) {
  console.log('\n✓ 环境变量配置成功！')
} else {
  console.log('\n✗ 环境变量配置失败')
  console.log('实际值:', config.truncate)
  console.log('期望值:', expected)
}
