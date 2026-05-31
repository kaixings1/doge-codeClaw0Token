import type { Command, LocalCommandCall } from '../types/command.js'
import { gitExe } from '../utils/git.js'
import { execFileNoThrow } from '../utils/execFileNoThrow.js'
import { getCwd } from '../utils/cwd.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * 获取用户名用于分支命名
 */
function getUsername(): string {
  // 优先使用 SAFEUSER 环境变量
  if (process.env.SAFEUSER) {
    return process.env.SAFEUSER.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  }
  // 回退到 USER 环境变量
  if (process.env.USER) {
    return process.env.USER.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  }
  return 'user'
}

/**
 * 生成分支名
 */
function generateBranchName(feature: string): string {
  const username = getUsername()
  const safeFeature = feature
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
  
  if (!safeFeature) {
    return `${username}/update-${Date.now()}`
  }
  return `${username}/${safeFeature}`
}

/**
 * 获取当前分支名
 */
async function getCurrentBranch(): Promise<string | null> {
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    ['branch', '--show-current'],
    { preserveOutputOnError: false },
  )
  return code === 0 ? stdout.trim() : null
}

/**
 * 检查分支是否已存在 PR
 */
async function getExistingPr(branch: string): Promise<{ exists: boolean; number?: number }> {
  const { stdout, code } = await execFileNoThrow(
    'gh',
    ['pr', 'view', '--json', 'number', '--jq', '.number'],
    { preserveOutputOnError: false },
  )
  
  if (code === 0 && stdout.trim()) {
    const number = parseInt(stdout.trim(), 10)
    return { exists: true, number }
  }
  return { exists: false }
}

/**
 * 从提交消息生成 PR 标题和正文
 */
function generatePrContent(commits: string[]): { title: string; body: string } {
  // 使用第一个提交的消息作为标题
  const firstCommit = commits[0] || ''
  const title = firstCommit.split('\n')[0].substring(0, 70)
  
  const body = `## 摘要
${commits.map(c => `- ${c.split('\n')[0]}`).join('\n')}

## 测试计划
- [ ] 运行现有测试
- [ ] 手动验证更改

## 变更说明
${commits.join('\n\n')}
`
  
  return { title: title || '更新代码', body }
}

/**
 * 获取最近的提交消息
 */
async function getRecentCommits(branch: string, defaultBranch: string): Promise<string[]> {
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    ['log', '--oneline', '--format=%s', `${defaultBranch}..${branch}`],
    { preserveOutputOnError: false },
  )
  
  if (code !== 0 || !stdout.trim()) {
    return ['更新代码']
  }
  
  return stdout.trim().split('\n')
}

/**
 * 获取默认分支
 */
async function getDefaultBranch(): Promise<string> {
  // 尝试获取远程默认分支
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    ['remote', 'show', 'origin', '--', 'HEAD'],
    { preserveOutputOnError: false },
  )
  
  if (code === 0) {
    const match = stdout.match(/HEAD branch: (\S+)/)
    if (match) {
      return match[1]
    }
  }
  
  // 回退到常见分支名
  const candidates = ['main', 'master', 'develop']
  for (const candidate of candidates) {
    const { code: checkCode } = await execFileNoThrow(
      gitExe(),
      ['rev-parse', '--verify', candidate],
      { preserveOutputOnError: false },
    )
    if (checkCode === 0) {
      return candidate
    }
  }
  
  return 'main'
}

/**
 * 解析命令参数
 */
function parseArgs(args: string): { message: string; feature: string; noPush: boolean; noPr: boolean } {
  const result = {
    message: '',
    feature: '',
    noPush: false,
    noPr: false,
  }
  
  // 检查标志
  if (args.includes('--no-push')) result.noPush = true
  if (args.includes('--no-pr')) result.noPr = true
  
  // 提取消息和功能描述
  const mFlagMatch = args.match(/-m\s+["']([^"']+)["']/)
  if (mFlagMatch) {
    result.message = mFlagMatch[1]
    // 剩余部分作为 feature
    const remaining = args.replace(/-m\s+["'][^"']+["']/, '').trim()
    result.feature = remaining
      .split(/\s+/)
      .filter(f => f && !f.startsWith('-'))
      .join('-')
  } else {
    // 无 -m 标志，整个参数作为 feature
    result.feature = args
      .replace(/--no-push|--no-pr/g, '')
      .trim()
      .replace(/\s+/g, '-')
  }
  
  return result
}

const call: LocalCommandCall = async (args, context) => {
  const cwd = getCwd()
  const defaultBranch = await getDefaultBranch()
  const currentBranch = await getCurrentBranch()
  
  // 检查是否在默认分支上
  if (currentBranch === defaultBranch && !args.includes('--force')) {
    return {
      type: 'text',
      value: `当前在 ${defaultBranch} 分支上。\n建议先创建功能分支。使用 --force 强制在当前分支操作。`,
    }
  }
  
  const { message, feature, noPush, noPr } = parseArgs(args)
  
  try {
    // 1. 如果不在功能分支上，创建新分支
    let targetBranch = currentBranch
    if (currentBranch === defaultBranch) {
      targetBranch = generateBranchName(feature || 'feature')
      context.updateProgress?.(`创建分支: ${targetBranch}`)
      
      const { code: checkoutCode, stderr: checkoutStderr } = await execFileNoThrow(
        gitExe(),
        ['checkout', '-b', targetBranch],
        { preserveOutputOnError: false },
      )
      
      if (checkoutCode !== 0) {
        return {
          type: 'text',
          value: `创建分支失败：\n${checkoutStderr || '未知错误'}`,
        }
      }
    }
    
    // 2. 检查是否有更改需要提交
    const { stdout: statusStdout } = await execFileNoThrow(
      gitExe(),
      ['status', '--porcelain'],
      { preserveOutputOnError: false },
    )
    
    if (statusStdout.trim()) {
      context.updateProgress?.('暂存更改...')
      
      // 暂存所有更改
      const { code: addCode, stderr: addStderr } = await execFileNoThrow(
        gitExe(),
        ['add', '-A'],
        { preserveOutputOnError: false },
      )
      
      if (addCode !== 0) {
        return {
          type: 'text',
          value: `暂存更改失败：\n${addStderr || '未知错误'}`,
        }
      }
      
      // 提交
      const commitMessage = message || `更新: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`
      context.updateProgress?.('创建提交...')
      
      const { code: commitCode, stderr: commitStderr } = await execFileNoThrow(
        gitExe(),
        ['commit', '-m', commitMessage],
        { preserveOutputOnError: false },
      )
      
      if (commitCode !== 0) {
        return {
          type: 'text',
          value: `提交失败：\n${commitStderr || '未知错误'}`,
        }
      }
    } else {
      // 没有更改，但可能已有提交
      const { stdout: commitCount } = await execFileNoThrow(
        gitExe(),
        ['rev-list', '--count', `${defaultBranch}..${targetBranch}`],
        { preserveOutputOnError: false },
      )
      
      if (parseInt(commitCount.trim(), 10) === 0) {
        return {
          type: 'text',
          value: '没有要提交的更改。使用 /status 查看当前状态。',
        }
      }
    }
    
    // 3. 推送到远程
    let pushOutput = ''
    if (!noPush) {
      context.updateProgress?.('推送到远程...')
      
      const { code: pushCode, stdout: pushStdout, stderr: pushStderr } = await execFileNoThrow(
        gitExe(),
        ['push', '-u', 'origin', targetBranch],
        { preserveOutputOnError: false },
      )
      
      if (pushCode !== 0) {
        return {
          type: 'text',
          value: `推送失败：\n${pushStderr || pushStdout || '未知错误'}\n\n尝试手动推送：git push -u origin ${targetBranch}`,
        }
      }
      pushOutput = '✓ 已推送到远程\n'
    }
    
    // 4. 创建或更新 PR
    let prOutput = ''
    if (!noPr) {
      context.updateProgress?.('检查现有 PR...')
      
      const existingPr = await getExistingPr(targetBranch)
      const commits = await getRecentCommits(targetBranch, defaultBranch)
      const { title, body } = generatePrContent(commits)
      
      if (existingPr.exists && existingPr.number) {
        context.updateProgress?.('更新 PR...')
        const { code: editCode, stdout: editStdout, stderr: editStderr } = await execFileNoThrow(
          'gh',
          ['pr', 'edit', existingPr.number.toString(), '--title', title, '--body', body],
          { preserveOutputOnError: false },
        )
        
        if (editCode === 0) {
          prOutput = `✓ 已更新 PR #${existingPr.number}\n  ${await getPrUrl(existingPr.number)}`
        } else {
          prOutput = `⚠ 更新 PR 失败：${editStderr || editStdout || '未知错误'}\n`
        }
      } else {
        context.updateProgress?.('创建 PR...')
        
        // 使用 heredoc 风格传递多行正文
        const { code: createCode, stdout: createStdout, stderr: createStderr } = await execFileNoThrow(
          'gh',
          ['pr', 'create', '--title', title, '--body', body, '--base', defaultBranch],
          { preserveOutputOnError: false },
        )
        
        if (createCode === 0) {
          prOutput = `✓ 已创建 PR\n  ${createStdout.trim()}`
        } else {
          prOutput = `⚠ 创建 PR 失败：${createStderr || createStdout || '未知错误'}\n`
        }
      }
    }
    
    // 获取提交 hash
    const { stdout: hashStdout } = await execFileNoThrow(
      gitExe(),
      ['rev-parse', 'HEAD'],
      { preserveOutputOnError: false },
    )
    const commitHash = hashStdout.trim().substring(0, 7)
    
    let resultMessage = `✓ 完成\n\n分支: ${targetBranch}\n提交: ${commitHash}\n`
    if (pushOutput) resultMessage += `\n${pushOutput}`
    if (prOutput) resultMessage += `\n${prOutput}`
    
    resultMessage += `\n\n下一步:\n- 查看 PR: gh pr view${prOutput ? '' : ' --web'}\n- 合并 PR: gh pr merge`
    
    return {
      type: 'text',
      value: resultMessage,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return {
      type: 'text',
      value: `执行失败：${errorMsg}`,
    }
  }
}

/**
 * 获取 PR URL
 */
async function getPrUrl(prNumber: number): Promise<string> {
  const { stdout, code } = await execFileNoThrow(
    'gh',
    ['pr', 'view', prNumber.toString(), '--json', 'url', '--jq', '.url'],
    { preserveOutputOnError: false },
  )
  
  if (code === 0 && stdout.trim()) {
    return stdout.trim()
  }
  return `https://github.com/ PR #${prNumber}`
}

const commitPushPr: Command = {
  type: 'local',
  name: 'commit-push-pr',
  description: '提交、推送并创建拉取请求',
  argumentHint: '[-m <消息>] [功能描述] [--no-push] [--no-pr]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
}

export default commitPushPr
