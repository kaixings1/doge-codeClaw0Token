import type { Command, LocalCommandCall } from '../types/command.js'
import { gitExe } from '../utils/git.js'
import { execFileNoThrow } from '../utils/execFileNoThrow.js'

/**
 * 解析 commit 命令参数
 * 支持的格式：
 *   /commit -m "message" [file1 file2 ...]
 *   /commit "message" [file1 file2 ...]
 */
function parseCommitArgs(args: string): { message: string; files: string[] } {
  let message = ''
  let files: string[] = []

  // 尝试解析 -m 标志
  const mFlagMatch = args.match(/-m\s+["']([^"']+)["']/)
  if (mFlagMatch) {
    message = mFlagMatch[1]
    // 从参数中移除 -m 部分，剩下的作为文件列表
    const remaining = args.replace(/-m\s+["'][^"']+["']/, '').trim()
    files = remaining
      .split(/\s+/)
      .filter(f => f && !f.startsWith('-'))
  } else {
    // 第一个引号内的内容作为消息，或者第一段作为消息
    const quotedMatch = args.match(/["']([^"']+)["']/)
    if (quotedMatch) {
      message = quotedMatch[1]
      const remaining = args.replace(/["'][^"']+["']/, '').trim()
      files = remaining
        .split(/\s+/)
        .filter(f => f && !f.startsWith('-'))
    } else {
      // 无引号消息：第一个词作为消息
      const parts = args.trim().split(/\s+/)
      if (parts.length > 0) {
        message = parts[0]
        files = parts.slice(1).filter(f => !f.startsWith('-'))
      }
    }
  }

  return { message, files }
}

const call: LocalCommandCall = async (args, context) => {
  // 如果没有参数，显示帮助信息
  if (!args.trim()) {
    return {
      type: 'text',
      value: `用法：/commit <消息> [文件...]
      或 /commit -m "<消息>" [文件...]

示例：
  /commit "修复登录 bug"
  /commit -m "添加新功能" src/index.ts
  /commit "更新文档" README.md docs/

选项：
  -m <消息>  - 指定提交消息

如果没有提供文件，将提交所有已暂存的更改。
要查看当前状态，请运行 /status。`,
    }
  }

  const { message, files } = parseCommitArgs(args)

  if (!message) {
    return {
      type: 'text',
      value: '错误：必须提供提交消息。\n使用 /commit "你的消息"',
    }
  }

  try {
    // 1. 如果有指定文件，添加它们
    if (files.length > 0) {
      const addArgs = ['add', ...files]
      const { code: addCode, stderr: addStderr } = await execFileNoThrow(
        gitExe(),
        addArgs,
        { preserveOutputOnError: false },
      )

      if (addCode !== 0) {
        return {
          type: 'text',
          value: `添加文件失败：\n${addStderr || '未知错误'}`,
        }
      }
    }

    // 2. 检查是否有更改需要提交
    const { stdout: statusStdout } = await execFileNoThrow(
      gitExe(),
      ['status', '--porcelain'],
      { preserveOutputOnError: false },
    )

    if (!statusStdout.trim()) {
      return {
        type: 'text',
        value: '没有要提交的更改。使用 /status 查看当前状态。',
      }
    }

    // 3. 执行提交
    const commitArgs = ['commit', '-m', message]
    const { code: commitCode, stdout: commitStdout, stderr: commitStderr } =
      await execFileNoThrow(gitExe(), commitArgs, {
        preserveOutputOnError: false,
      })

    if (commitCode !== 0) {
      return {
        type: 'text',
        value: `提交失败：\n${commitStderr || commitStdout || '未知错误'}`,
      }
    }

    // 4. 获取新提交的 hash
    const { stdout: hashStdout } = await execFileNoThrow(
      gitExe(),
      ['rev-parse', 'HEAD'],
      { preserveOutputOnError: false },
    )

    const commitHash = hashStdout.trim().substring(0, 7)

    return {
      type: 'text',
      value: `✓ 提交成功 [${commitHash}]\n消息：${message}\n文件：${files.length > 0 ? files.join(', ') : '所有暂存更改'}`,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return {
      type: 'text',
      value: `执行失败：${errorMsg}`,
    }
  }
}

const commit: Command = {
  type: 'local',
  name: 'commit',
  description: '创建 git 提交',
  argumentHint: '[-m] <消息> [文件...]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
}

export default commit
