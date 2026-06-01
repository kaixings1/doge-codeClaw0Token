import type { Command } from '../../commands.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { Box, Text } from '../../ink.js'
import * as React from 'react'

function maskSensitive(value: string): string {
  if (value.length > 8 && /[A-Z0-9]/.test(value)) {
    return value.slice(0, 4) + '***' + value.slice(-4)
  }
  return value
}

export const call: LocalJSXCommandCall = async () => {
  const importantVars = ['NODE_ENV', 'PATH', 'HOME', 'USER', 'CLAUDE_CODE_SESSION_ID', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'USER_TYPE']
  const envVars = importantVars.map(name => ({ name, value: process.env[name] || '（未设置）' }))

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>🔧 环境变量</Text>
      <Box marginTop={1} flexDirection="column">
        {envVars.map(({ name, value }) => (
          <Box key={name}>
            <Text color="cyan">{name}: </Text>
            <Text>{name.includes('KEY') || name.includes('TOKEN') ? maskSensitive(value) : value}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

const env = {
  type: 'local-jsx',
  name: 'env',
  description: '显示环境变量',
  load: () => Promise.resolve({ call }),
} satisfies Command

export default env