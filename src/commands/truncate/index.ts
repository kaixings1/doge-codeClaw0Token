/**
 * /truncate 命令 - 查看和配置上下文截断
 */

export const truncateCommand = {
  name: 'truncate',
  aliases: ['context', 'compact-stats'],
  description: '查看上下文截断统计和配置',
  subcommands: [
    {
      name: 'status',
      description: '显示当前截断状态',
      action: function* (args, deps) {
        const truncateEventHistory = []
        const stats = {
          totalRemoved: 0,
          totalFreedTokens: 0,
          avgPriorityScore: 0,
          lastReason: '无',
        }

        deps.stdout.write(`\n=== 上下文截断状态 ===\n\n`)
        deps.stdout.write('配置:\n')
        deps.stdout.write('  警告阈值：3000 tokens\n')
        deps.stdout.write('  精简阈值：3500 tokens\n')
        deps.stdout.write('  错误阈值：4000 tokens\n')
        deps.stdout.write('  最大历史消息：50\n')
        deps.stdout.write('  始终保留最后：20 条\n\n')

        deps.stdout.write('统计 (最近截断):\n')
        deps.stdout.write(`  截断次数：${truncateEventHistory.length}\n`)
        deps.stdout.write(`  总删除消息：${stats.totalRemoved}\n`)
        deps.stdout.write(`  释放 tokens: ${stats.totalFreedTokens.toLocaleString()}\n`)
        deps.stdout.write(`  平均优先级：${stats.avgPriorityScore.toFixed(2)}\n\n`)

        yield { done: true }
      },
    },
    {
      name: 'config',
      description: '显示截断配置说明',
      action: function* (args, deps) {
        deps.stdout.write(`\n=== 截断配置说明 ===\n\n`)
        deps.stdout.write('环境变量:\n')
        deps.stdout.write('  CLAUDE_TRUNCATE_WARN_THRESHOLD=2500\n')
        deps.stdout.write('  CLAUDE_TRUNCATE_COMPACT_THRESHOLD=3000\n')
        deps.stdout.write('  CLAUDE_TRUNCATE_ERROR_THRESHOLD=3500\n')
        deps.stdout.write('  CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES=30\n')
        deps.stdout.write('  CLAUDE_KEEP_LAST_MESSAGES=15\n\n')

        yield { done: true }
      },
    },
  ],
}
