/**
 * 工具调用执行器（增强版）
 * 自动接收、处理和执行来自服务器的工具调用指令。
 *
 * 支持的格式：tool_json {"tool":"exec","parameters":{"command":"..."}}
 *
 * 增强内容（满足四项需求）：
 * - 跨平台命令映射与回退执行
 * - 命令安全校验
 * - 全局编码配置，解决中文乱码
 * - 可扩展工具注册表
 * - 详细的执行日志与错误上下文
 */

import { Bash } from '../../../tools/bash/index.js'
import { exec } from '../../utils/Shell.js'
import type { ShellCommand } from '../../utils/ShellCommand.js'

// ==================== 全局配置（新增，可测试） ====================

export interface ToolExecutorConfig {
  /** 子进程编码，默认 'utf8' */
  encoding: BufferEncoding
  /** 结果输出编码，用于处理乱码。若为 'gbk'，将尝试从 binary 转 utf8 */
  outputEncoding: 'utf8' | 'gbk' | 'auto'
  /** 命令执行失败时是否启用平台回退 */
  fallbackOnFailure: boolean
  /** 回退尝试的最大次数（不同 shell） */
  maxFallbackAttempts: number
  /** 自定义解码函数，完全控制输出转换 */
  decodeOutput?: (text: string) => string
  /** 命令映射表（Unix -> Windows） */
  commandMappings?: Record<string, string>
  /** 备选 shell 列表，按优先级排列 */
  fallbackShells: Array<'bash' | 'powershell' | 'cmd'>
  /** 是否启用调试日志 */
  debug: boolean
}

/** 默认全局配置 */
export const toolExecutorConfig: ToolExecutorConfig = {
  encoding: 'utf8',
  outputEncoding: 'auto',
  fallbackOnFailure: true,
  maxFallbackAttempts: 2,
  decodeOutput: undefined,
  commandMappings: {
    // 常用 Unix 命令映射到 Windows 对应命令（自动替换）
    'ls': 'dir',
    'cat': 'type',
    'rm': 'del',
    'cp': 'copy',
    'mv': 'move',
    'pwd': 'cd',
    'clear': 'cls',
    'grep': 'findstr',
    // 可继续添加
  },
  fallbackShells: ['bash', 'powershell', 'cmd'],
  debug: true, // 默认开启调试日志
}

// ==================== 调试日志函数 ====================
function debugLog(...args: any[]): void {
  if (toolExecutorConfig.debug) {
    console.log('[ToolExecutor Debug]', new Date().toISOString(), ...args);
  }
}

// ==================== 工具接口（保持原样） ====================

export interface ToolCall {
  tool: string
  parameters: Record<string, any>
}

export interface ToolResult {
  success: boolean
  tool: string
  parameters: Record<string, any>
  result: any
  error?: string
  timestamp: string
  executionTime: string
}

// ==================== 工具注册表（增强） ====================

type ToolExecutor = (parameters: Record<string, any>) => Promise<any>
const toolRegistry: Record<string, ToolExecutor> = {}

/** 注册自定义工具处理器 */
export function registerTool(name: string, executor: ToolExecutor): void {
  const lowerName = name.toLowerCase()
  if (toolRegistry[lowerName]) {
    console.warn(`[ToolExecutor] 工具 "${name}" 已被覆盖`)
  }
  toolRegistry[lowerName] = executor
}

/** 获取已注册的所有工具名称 */
export function registeredTools(): string[] {
  return Object.keys(toolRegistry)
}

// 预注册内置工具
registerTool('exec', executeExecTool)
registerTool('clear', executeClearTool)
registerTool('bash', executeBashTool)

// ==================== 内部辅助函数（新增） ====================

/**
 * 检测当前操作系统是否为 Windows
 */
function isWindows(): boolean {
  return process.platform === 'win32'
}

/**
 * 基础命令安全校验
 */
function validateCommand(command: string): void {
  if (!command || command.trim().length === 0) {
    throw new Error('命令不能为空')
  }
  // 可根据需要扩展更严格的安全策略
}

/**
 * 智能判断命令应该使用的 shell
 * 规则：
 * - 如果命令以 'cmd /c' 开头，优先用 cmd
 * - 如果命令包含 Windows 路径（如 C:\ 或 \），优先用 cmd
 * - 如果命令中有 PowerShell 特有语法（如 | select, Get-ChildItem），优先用 powershell
 * - 否则保持原回退顺序
 */
function determineOptimalShell(command: string): 'bash' | 'powershell' | 'cmd' | null {
  const lowerCmd = command.toLowerCase();
  
  // 明确要求 cmd
  if (lowerCmd.startsWith('cmd /c') || lowerCmd.startsWith('cmd.exe /c')) {
    debugLog(`命令以 "cmd /c" 开头，选择 cmd shell`);
    return 'cmd';
  }
  
  // Windows 路径特征
  if (/^[a-z]:\\/i.test(command) || command.includes('\\') || command.includes(':\\')) {
    debugLog(`检测到 Windows 路径，选择 cmd shell`);
    return 'cmd';
  }
  
  // PowerShell 特有语法
  if (/\b(Get-|Select-|Where-|ForEach-|Out-|Write-|Format-)\b/i.test(command) ||
      command.includes('| select') || command.includes('| where') ||
      command.includes('$') || command.includes('@(')) {
    debugLog(`检测到 PowerShell 语法，选择 powershell shell`);
    return 'powershell';
  }
  
  // 默认返回 null，表示使用配置的 fallbackShells 顺序
  return null;
}

/**
 * 修复输出编码问题（针对 GBK 乱码场景）
 */
function normalizeOutput(text: string): string {
  const config = toolExecutorConfig
  if (config.decodeOutput) {
    return config.decodeOutput(text)
  }

  if (config.outputEncoding === 'utf8') return text

  // 自动检测：如果文本中包含常见的乱码特征，尝试修复
  if (config.outputEncoding === 'auto') {
    // 简单启发式：若存在非ASCII字节且UTF-8解码后出现替换字符，尝试binary->utf8
    const hasReplacementChars = text.includes('\ufffd')
    if (hasReplacementChars && isWindows()) {
      try {
        // 将当前字符串视为 binary 乱码，转回 buffer 后再用 utf8 解码
        const fixed = Buffer.from(text, 'binary').toString('utf8')
        // 只保留可打印字符
        const cleaned = fixed.replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '')
        debugLog(`编码自动修复: 原长度 ${text.length}, 修复后长度 ${cleaned.length}`);
        return cleaned
      } catch (e) {
        debugLog(`编码自动修复失败: ${e}`);
        return text
      }
    }
    return text
  }

  // 指定 GBK 编码
  if (config.outputEncoding === 'gbk') {
    try {
      const fixed = Buffer.from(text, 'binary').toString('utf8')
      debugLog(`GBK 转 UTF-8 完成，原长度 ${text.length}`);
      return fixed
    } catch (e) {
      debugLog(`GBK 转换失败: ${e}`);
      return text
    }
  }
  return text
}

/**
 * 命令转换：将 Unix 命令转为当前平台可用形式
 * 支持直接映射和简单参数替换
 */
function convertCommand(command: string, shell: 'bash' | 'powershell' | 'cmd'): string {
  if (shell === 'bash') return command // 无需转换

  const parts = command.trim().split(/\s+/)
  const cmdName = parts[0]
  const args = parts.slice(1)

  const mappings = toolExecutorConfig.commandMappings || {}
  const mappedCmd = mappings[cmdName]
  if (!mappedCmd) {
    // 无映射，保持原命令（可能在 powershell/cmd 中无法执行）
    return command
  }

  if (shell === 'powershell') {
    // 对常见参数进行简单转换
    const convertedArgs = args.map(arg => {
      // 例如 -l 在 dir 中不需要，可以忽略或转为 /s /b
      if (arg === '-l' || arg === '-la') return ''
      return arg
    }).filter(Boolean)

    // 若映射为 dir，自动添加常用参数
    if (mappedCmd === 'dir') {
      return `Get-ChildItem ${convertedArgs.join(' ')}`.trim()
    }
    return `${mappedCmd} ${convertedArgs.join(' ')}`.trim()
  }

  if (shell === 'cmd') {
    const convertedArgs = args.map(arg => {
      if (arg === '-l') return '/s /b'
      return arg
    })
    return `${mappedCmd} ${convertedArgs.join(' ')}`.trim()
  }

  return command
}

/**
 * 带超时和回退的命令执行核心（增强版）
 */
async function executeCommandWithFallback(
  command: string,
  signal: AbortSignal,
  timeout: number,
  runInBackground: boolean
): Promise<{ stdout: string; stderr: string; code: number; interrupted: boolean }> {
  const config = toolExecutorConfig
  let lastError: Error | undefined
  
  // 智能选择最优 shell
  const optimalShell = determineOptimalShell(command);
  let shellsToTry: Array<'bash' | 'powershell' | 'cmd'>;
  if (optimalShell) {
    // 将最优 shell 放在第一位，其余按原顺序
    shellsToTry = [optimalShell, ...config.fallbackShells.filter(s => s !== optimalShell)];
    debugLog(`根据命令内容确定优先 shell: ${optimalShell}, 尝试顺序: ${shellsToTry.join(', ')}`);
  } else {
    shellsToTry = config.fallbackShells.slice();
    debugLog(`未检测到特定 shell 需求，使用默认顺序: ${shellsToTry.join(', ')}`);
  }
  
  // 限制尝试次数
  shellsToTry = shellsToTry.slice(0, config.maxFallbackAttempts);
  
  for (const shell of shellsToTry) {
    try {
      const finalCommand = shell === 'bash' ? command : convertCommand(command, shell)
      debugLog(`[尝试 ${shell}] 原始命令: ${command}`);
      debugLog(`[尝试 ${shell}] 转换后命令: ${finalCommand}`);

      const shellCmd: ShellCommand = await exec(
        finalCommand,
        signal,
        shell,
        {
          timeout,
          shouldAutoBackground: runInBackground,
          env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } as any,
        },
      )

      const result = await shellCmd.result
      debugLog(`[尝试 ${shell}] 退出码: ${result.code}, stdout 长度: ${result.stdout?.length || 0}, stderr 长度: ${result.stderr?.length || 0}`);

      // 检查是否需要回退（退出码非 0 且配置允许且还有下一个 shell）
      if (result.code !== 0 && config.fallbackOnFailure && shellsToTry.length > 1) {
        debugLog(`[尝试 ${shell}] 命令执行失败 (退出码 ${result.code})，尝试下一个 shell`);
        lastError = new Error(result.stderr || `Exit code ${result.code}`);
        continue
      }

      // 成功，规范化输出
      const stdout = normalizeOutput(result.stdout || '')
      const stderr = normalizeOutput(result.stderr || '')
      debugLog(`[成功] 使用 shell: ${shell}, 最终 stdout 编码后长度: ${stdout.length}`);
      return {
        stdout,
        stderr,
        code: result.code,
        interrupted: result.interrupted,
      }
    } catch (error: any) {
      debugLog(`[尝试 ${shell}] 执行异常:`, error.message);
      console.error(`[ToolExecutor] Shell ${shell} 执行异常:`, error.message)
      lastError = error
      // 继续尝试下一个 shell
    }
  }

  throw lastError || new Error('所有命令执行尝试均失败')
}

// ==================== 原公开函数（保持签名，增强内部） ====================

/**
 * 解析工具调用字符串
 */
export function parseToolCall(input: string): ToolCall | null {
  try {
    const jsonStr = input.replace(/^tool_json\s*/, '').trim()
    if (!jsonStr.startsWith('{')) {
      console.error('[ToolExecutor] 工具调用格式错误：找不到 JSON 对象')
      return null
    }

    const data = JSON.parse(jsonStr)

    if (!data.tool || typeof data.tool !== 'string') {
      console.error('[ToolExecutor] 无效的工具调用：缺少 tool 字段')
      return null
    }

    if (!data.parameters || typeof data.parameters !== 'object') {
      console.error('[ToolExecutor] 无效的工具调用：缺少 parameters 字段')
      return null
    }

    return {
      tool: data.tool,
      parameters: data.parameters,
    }
  } catch (error: any) {
    console.error('[ToolExecutor] 解析工具调用失败:', error.message)
    return null
  }
}

/**
 * 执行单个工具调用（根据注册表分发）
 */
export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  const startTime = Date.now()
  debugLog(`执行工具: ${toolCall.tool}, 参数:`, toolCall.parameters);

  try {
    console.log(`[ToolExecutor] 执行工具: ${toolCall.tool}`)

    const executor = toolRegistry[toolCall.tool.toLowerCase()]
    if (!executor) {
      throw new Error(`未知的工具: "${toolCall.tool}"。可用工具: ${registeredTools().join(', ')}`)
    }

    const result = await executor(toolCall.parameters)
    const executionTime = Date.now() - startTime

    return {
      success: true,
      tool: toolCall.tool,
      parameters: toolCall.parameters,
      result: {
        ...result,
        executionTime: `${executionTime}ms`,
      },
      timestamp: new Date().toISOString(),
      executionTime: `${executionTime}ms`,
    }
  } catch (error: any) {
    const executionTime = Date.now() - startTime
    console.error(`[ToolExecutor] 工具 ${toolCall.tool} 执行失败:`, error.message)
    debugLog(`工具执行失败: ${error.message}, 堆栈:`, error.stack);

    return {
      success: false,
      tool: toolCall.tool,
      parameters: toolCall.parameters,
      result: null,
      error: error.message,
      timestamp: new Date().toISOString(),
      executionTime: `${executionTime}ms`,
    }
  }
}

/**
 * 处理单个工具调用字符串并返回 JSON
 */
export async function handleToolCall(input: string): Promise<string> {
  console.log('[ToolExecutor] 收到工具调用请求')
  debugLog(`原始输入: ${input.substring(0, 200)}${input.length > 200 ? '...' : ''}`);

  const toolCall = parseToolCall(input)
  if (!toolCall) {
    const errorResult: ToolResult = {
      success: false,
      tool: 'unknown',
      parameters: {},
      result: null,
      error: '无法解析工具调用格式',
      timestamp: new Date().toISOString(),
      executionTime: '0ms',
    }
    return JSON.stringify(errorResult, null, 2)
  }

  const result = await executeToolCall(toolCall)
  return JSON.stringify(result, null, 2)
}

/**
 * 批量处理工具调用
 */
export async function handleToolCalls(inputs: string[]): Promise<string[]> {
  const results: string[] = []
  for (const input of inputs) {
    try {
      const result = await handleToolCall(input)
      results.push(result)
    } catch (error: any) {
      console.error('[ToolExecutor] 批量处理单条失败:', error.message)
      const failResult: ToolResult = {
        success: false,
        tool: 'unknown',
        parameters: {},
        result: null,
        error: `批量处理异常: ${error.message}`,
        timestamp: new Date().toISOString(),
        executionTime: '0ms',
      }
      results.push(JSON.stringify(failResult, null, 2))
    }
  }
  return results
}

/**
 * 检查输入是否为工具调用格式
 */
export function isToolCall(input: string): boolean {
  return input.trim().startsWith('tool_json')
}

/** 支持的工具列表 */
export const SUPPORTED_TOOLS = ['exec', 'clear', 'bash'] as const
export type SupportedTool = (typeof SUPPORTED_TOOLS)[number]

// ==================== 内置工具实现（增强） ====================

/**
 * 执行 exec 工具 —— 运行系统命令（自动平台适配与回退）
 */
async function executeExecTool(parameters: any): Promise<any> {
  const {
    command,
    description,
    timeout = 30000,
    run_in_background = false,
  } = parameters

  if (!command) {
    throw new Error('exec 工具需要 command 参数')
  }

  validateCommand(command)

  console.log(`[ToolExecutor] 执行命令: ${command}`)
  debugLog(`Exec 工具参数: timeout=${timeout}, background=${run_in_background}`);

  const abortController = new AbortController()
  const execResult = await executeCommandWithFallback(
    command,
    abortController.signal,
    timeout,
    run_in_background,
  )

  return {
    action: 'exec',
    command,
    description: description || '执行命令',
    output: execResult.stdout,
    error: execResult.stderr,
    exitCode: execResult.code,
    interrupted: execResult.interrupted,
    status: execResult.code === 0 ? 'success' : 'failed',
    platform: process.platform,
  }
}

/**
 * 执行 clear 工具
 */
async function executeClearTool(parameters: any): Promise<any> {
  const { clearMessages = true, clearCaches = true, clearHistory = false } = parameters

  console.log('[ToolExecutor] 执行清除操作')
  debugLog(`Clear 工具参数: messages=${clearMessages}, caches=${clearCaches}, history=${clearHistory}`);

  return {
    action: 'clear',
    message: '对话已清除',
    clearedItems: [
      ...(clearMessages ? ['messages'] : []),
      ...(clearCaches ? ['caches'] : []),
      ...(clearHistory ? ['history'] : []),
      'session_data',
    ],
  }
}

/**
 * 执行 bash 工具 —— 与 exec 类似，语义更明确
 */
async function executeBashTool(parameters: any): Promise<any> {
  const { command, description, timeout = 30000 } = parameters

  if (!command) {
    throw new Error('bash 工具需要 command 参数')
  }

  validateCommand(command)

  console.log(`[ToolExecutor] 执行 bash 命令: ${command}`)
  debugLog(`Bash 工具参数: timeout=${timeout}`);

  const abortController = new AbortController()
  const execResult = await executeCommandWithFallback(
    command,
    abortController.signal,
    timeout,
    false,   // bash 工具默认不后台运行
  )

  return {
    action: 'bash',
    command,
    description: description || '执行 bash 命令',
    output: execResult.stdout,
    error: execResult.stderr,
    exitCode: execResult.code,
    interrupted: execResult.interrupted,
    status: execResult.code === 0 ? 'success' : 'failed',
    platform: process.platform,
  }
}