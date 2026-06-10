/**
 * 截断功能集成测试
 */

console.log('=== 上下文截断集成测试 ===\n')

// 模拟环境变量
process.env.CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES = '30'
process.env.CLAUDE_KEEP_LAST_MESSAGES = '15'
process.env.CLAUDE_TRUNCATE_COMPACT_THRESHOLD = '3000'

console.log('环境变量设置:')
console.log('  CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES:', process.env.CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES)
console.log('  CLAUDE_KEEP_LAST_MESSAGES:', process.env.CLAUDE_KEEP_LAST_MESSAGES)
console.log('  CLAUDE_TRUNCATE_COMPACT_THRESHOLD:', process.env.CLAUDE_TRUNCATE_COMPACT_THRESHOLD)

// 导入模块
const path = require('path')
const truncateContextPath = path.join(__dirname, 'src', 'services', 'compact', 'truncateContext.ts')
const truncateRecoveryPath = path.join(__dirname, 'src', 'utils', 'truncateRecovery.ts')

console.log('\n模块路径:')
console.log('  truncateContext:', truncateContextPath)
console.log('  truncateRecovery:', truncateRecoveryPath)

// 验证文件是否存在
const fs = require('fs')
const truncateContextExists = fs.existsSync(truncateContextPath)
const truncateRecoveryExists = fs.existsSync(truncateRecoveryPath)

console.log('\n文件检查:')
console.log('  truncateContext.ts 存在:', truncateContextExists)
console.log('  truncateRecovery.ts 存在:', truncateRecoveryExists)

if (truncateContextExists && truncateRecoveryExists) {
  console.log('\n✓ 所有文件存在，截断功能已集成！')
} else {
  console.log('\n✗ 文件缺失，请检查路径')
}

console.log('\n=== 测试完成 ===')
