import type { Command } from '../../commands.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { Box, Text, useInput } from '../../ink.js'
import * as React from 'react'

export const call: LocalJSXCommandCall = async (onDone, _context, _args) => {
  const [step, setStep] = React.useState(0)
  const steps = [
    { title: '👋 欢迎', content: '欢迎使用 Claude Code！按 Enter 开始配置' },
    { title: '📝 角色', content: '你的主要开发角色是什么？', options: ['后端', '前端', '全栈', 'DevOps', '其他'] },
    { title: '🔧 任务', content: '最常用的任务？', options: ['编码', '审查', '调试', '重构', '文档'] },
    { title: '✅ 完成', content: '配置完成！感谢使用' }
  ]
  const [answers, setAnswers] = React.useState<Record<number, number>>({})

  useInput((input, key) => {
    if (key.escape) { onDone(undefined, { display: 'skip' }); return }
    if (step === 0 || step === steps.length - 1) {
      if (key.return) setStep(step + 1)
      return
    }
    const num = parseInt(input)
    if (!isNaN(num) && num >= 1 && num <= steps[step].options!.length) {
      setAnswers({ ...answers, [step]: num - 1 })
      setStep(step + 1)
    }
  })

  const current = steps[step]
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{current.title}</Text>
      <Box marginTop={1}><Text>{current.content}</Text></Box>
      {current.options && (
        <Box marginTop={1} flexDirection="column">
          {current.options.map((opt, i) => <Text key={i}>{i+1}. {opt}</Text>)}
          <Text dimColor marginTop={1}>输入数字选择</Text>
        </Box>
      )}
      {!current.options && <Text dimColor marginTop={1}>按 Enter 继续</Text>}
    </Box>
  )
}

const onboarding = {
  type: 'local-jsx',
  name: 'onboarding',
  description: '显示性能信息',
  load: () => Promise.resolve({ call }),
} satisfies Command

export default onboarding