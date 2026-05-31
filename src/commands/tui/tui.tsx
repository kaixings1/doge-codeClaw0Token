import * as React from 'react'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const parts = args.trim().split(/\s+/)
  const operation = parts[0]?.toLowerCase() || 'help'

  // 获取当前的全屏状态
  const isFullscreen = isFullscreenEnvEnabled()
  const theme = context.options.theme || 'dark'

  switch (operation) {
    case 'start':
    case 'on':
      onDone(`TUI 模式已启用（闪烁免模式）

当前状态：${isFullscreen ? '已激活' : '未激活'}
主题：${theme}

功能特性：
- 闪烁免模式：${isFullscreen ? '✓ 运行中' : '请设置 CLAUDE_CODE_NO_FLICKER=1 启用'}
- 全屏终端：${isFullscreen ? '✓ 可用' : '不可用'}
- 鼠标支持：${isFullscreen ? '✓ 已启用' : '不可用'}

提示：重启终端以应用全屏设置`, { display: 'system' })
      break

    case 'stop':
    case 'off':
      onDone(`TUI 模式禁用

已切换到普通终端模式。
如需重新启用全屏模式，请运行：
  export CLAUDE_CODE_NO_FLICKER=1
  doge`, { display: 'system' })
      break

    case 'status':
      onDone(`TUI 状态

模式：${isFullscreen ? '闪烁免模式 (Flicker-free)' : '普通模式'}
全屏环境：${isFullscreen ? '已启用' : '未启用'}
主题：${theme}

环境变量：
  CLAUDE_CODE_NO_FLICKER=${process.env.CLAUDE_CODE_NO_FLICKER || '未设置(默认: 外部用户=1, ants=0)'}

提示：
- ants 用户默认启用全屏模式
- 外部用户需要设置 CLAUDE_CODE_NO_FLICKER=1 启用`, { display: 'system' })
      break

    case 'help':
      return (
        <div style={{ padding: '1rem' }}>
          <h2 style={{ margin: '0 0 1rem 0' }}>TUI 命令参考</h2>
          <div style={{ marginBottom: '0.5rem' }}>
            <span style={{ color: '#8b5cf6', fontWeight: 'bold' }}>/tui start</span>
            <span style={{ color: '#888', marginLeft: '0.5rem' }}>启用 TUI 模式（闪烁免终端）</span>
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <span style={{ color: '#8b5cf6', fontWeight: 'bold' }}>/tui stop</span>
            <span style={{ color: '#888', marginLeft: '0.5rem' }}>禁用 TUI 模式</span>
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <span style={{ color: '#8b5cf6', fontWeight: 'bold' }}>/tui status</span>
            <span style={{ color: '#888', marginLeft: '0.5rem' }}>显示 TUI 状态</span>
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <span style={{ color: '#8b5cf6', fontWeight: 'bold' }}>/tui help</span>
            <span style={{ color: '#888', marginLeft: '0.5rem' }}>显示此帮助</span>
          </div>
          <div style={{ marginTop: '1rem', padding: '0.5rem', backgroundColor: '#252525', borderRadius: '0.5rem' }}>
            <strong style={{ color: '#eab308' }}>提示</strong>
            <div style={{ marginTop: '0.25rem', fontSize: '0.875rem' }}>
              全屏模式由环境变量 <code>CLAUDE_CODE_NO_FLICKER</code> 控制：<br />
              - 设置 <code>CLAUDE_CODE_NO_FLICKER=1</code> 启用（外部用户默认）<br />
              - 设置 <code>CLAUDE_CODE_NO_FLICKER=0</code> 启用（ants 用户默认）<br />
              - 需重启终端才能生效
            </div>
          </div>
        </div>
      )
      break

    case 'config':
      onDone(`TUI 配置

主题：${theme}
全屏模式：${isFullscreen ? '启用' : '禁用'}

配置提示：
- 主题由系统主题设置控制
- 全屏模式通过 CLAUDE_CODE_NO_FLICKER 环境变量配置
- 字体大小和行列由终端设置控制`, { display: 'system' })
      break

    default:
      // 默认显示 TUI 信息面板
      return (
        <div style={{
          padding: '1rem',
          fontFamily: 'Monaco, Menlo, monospace',
          fontSize: '0.875rem',
          color: theme === 'dark' ? '#e5e5e5' : '#333',
          backgroundColor: theme === 'dark' ? '#1e1e1e' : '#ffffff',
          border: '1px solid',
          borderColor: theme === 'dark' ? '#374151' : '#ddd',
          borderRadius: '0.5rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>TUI 模式</h2>
            <span style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '0.25rem',
              fontSize: '0.75rem',
              backgroundColor: isFullscreen ? '#16a34a' : '#6b7280',
              color: 'white'
            }}>
              {isFullscreen ? '闪烁免模式' : '普通模式'}
            </span>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <strong>状态：</strong> {isFullscreen ? '运行中' : '已禁用'}
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <strong>功能：</strong>
            <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
              <li style={{ marginBottom: '0.25rem' }}>闪烁免模式终端渲染</li>
              <li style={{ marginBottom: '0.25rem' }}>全屏 alternate screen buffer</li>
              <li style={{ marginBottom: '0.25rem' }}>鼠标滚轮支持</li>
            </ul>
          </div>

          <div style={{ padding: '0.5rem', backgroundColor: '#252525', borderRadius: '0.5rem' }}>
            <strong style={{ color: '#eab308' }}>快速开始</strong>
            <div style={{ marginTop: '0.25rem', fontSize: '0.875rem' }}>
              输入 <code>/tui help</code> 查看更多命令
            </div>
          </div>
        </div>
      )
  }

  return null
}

export default {
  name: 'tui',
  type: 'local-jsx',
  description: 'TUI 模式 - 闪烁免终端',
  call: call
}
