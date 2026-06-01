import type { Command } from '../../commands.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { Box, Text, useInput } from '../../ink.js'
import * as React from 'react'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

interface Session {
  id: string
  timestamp: string
  cwd: string
}

async function loadSessions(): Promise<Session[]> {
  try {
    const file = path.join(os.homedir(), '.doge', 'sessions.json')
    const content = await fs.readFile(file, 'utf-8')
    return JSON.parse(content)
  } catch {
    return []
  }
}

async function saveSession(session: Session): Promise<void> {
  const sessions = await loadSessions()
  const existing = sessions.findIndex(s => s.id === session.id)
  if (existing >= 0) sessions[existing] = session
  else sessions.push(session)
  const file = path.join(os.homedir(), '.doge', 'sessions.json')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(sessions.slice(-20), null, 2))
}

function getCurrentSessionId(): string {
  return process.env.CLAUDE_CODE_SESSION_ID || `session_${Date.now()}`
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const [sessionId, setSessionId] = React.useState(args?.trim() || '')
  const [sessions, setSessions] = React.useState<Session[]>([])
  const [showList, setShowList] = React.useState(false)
  const [status, setStatus] = React.useState<'idle' | 'switching' | 'done'>('idle')

  React.useEffect(() => { loadSessions().then(setSessions) }, [])

  useInput(async (input, key) => {
    if (key.escape) { onDone(undefined, { display: 'skip' }); return }
    if (key.return && sessionId && status === 'idle') {
      setStatus('switching')
      const session = sessions.find(s => s.id === sessionId)
      if (session) {
        process.env.CLAUDE_CODE_SESSION_ID = sessionId
        if (session.cwd !== process.cwd()) process.chdir(session.cwd)
        setStatus('done')
        setTimeout(() => onDone(`✓ 已传送到会话: ${sessionId}`, { display: 'skip' }), 1000)
      } else {
        setStatus('idle')
      }
      return
    }
    if (input === '?' && status === 'idle') setShowList(!showList)
    if (status === 'idle') {
      if (input && !key.ctrl && !key.meta) setSessionId(prev => prev + input)
      if (key.backspace || key.delete) setSessionId(prev => prev.slice(0, -1))
    }
  })

  const currentId = getCurrentSessionId()
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>🚀 传送 (Teleport)</Text>
      <Box marginTop={1}><Text>当前会话: {currentId.slice(0, 16)}...</Text></Box>
      <Box marginTop={1}><Text>目标会话 ID: </Text><Text color="green">{sessionId || '_'}</Text></Box>
      {status === 'idle' && <Text dimColor>输入会话 ID 后按 Enter 传送 | ? 查看历史 | Esc 退出</Text>}
      {status === 'switching' && <Text color="yellow">正在传送...</Text>}
      {status === 'done' && <Text color="green">✓ 传送成功！</Text>}
      {showList && sessions.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>历史会话:</Text>
          {sessions.slice(-5).reverse().map(s => (
            <Box key={s.id}><Text color="yellow">{s.id.slice(0, 16)}...</Text><Text dimColor> - {new Date(s.timestamp).toLocaleString()}</Text></Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

const teleport = {
  type: 'local-jsx',
  name: 'teleport',
  description: '传送到另一个会话继续工作',
  aliases: ['goto'],
  argumentHint: '<session-id>',
  load: () => Promise.resolve({ call }),
} satisfies Command

export default teleport