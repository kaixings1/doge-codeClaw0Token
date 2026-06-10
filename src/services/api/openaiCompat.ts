import { APIError } from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { logForDebugging } from '../../utils/debug.js'

import type {
  BetaMessage,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

type AnyBlock = Record<string, any>

// OpenAI 兼容配置
export type OpenAICompatConfig = {
  apiKey: string
  baseURL: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}

// OpenAI 工具调用结构
export type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

// OpenAI 对话消息
export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
}

// 转换后的 OpenAI 请求体
export type OpenAIChatRequest = {
  model: string
  messages: OpenAIChatMessage[]
  stream?: boolean
  temperature?: number
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters?: unknown
    }
  }>
  tool_choice?: 'auto' | { type: 'function'; function: { name: string } }
  max_tokens?: number
}

// OpenAI 流式响应中的单个 chunk
export type OpenAIStreamChunk = {
  id?: string
  object?: string
  model?: string
  choices?: Array<{
    index?: number
    message?: {
      role?: 'assistant'
      content?: string | null
      tool_calls?: OpenAIToolCall[]
    }
    delta?: {
      role?: 'assistant'
      content?: string | null
      thinking?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

type OpenAIToolStreamState = {
  openAIIndex: number
  anthropicIndex?: number
  id: string
  name: string
  arguments: string
  queuedArgumentDeltas: string[]
  started: boolean
  closed: boolean
}

type NativeBlockState =
  | {
      kind: 'text'
      anthropicIndex: number
      text: string
    }
  | {
      kind: 'tool_use'
      anthropicIndex: number
      id: string
      name: string
      input: Record<string, unknown>
      partialJson: string
    }

/**
 * WSL 检测。
 * 本文件使用 ESM，因此使用 node:fs，而不是 require('fs')。
 */
function isWSL(): boolean {
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')
  } catch {
    return false
  }
}

/**
 * 将常见 Windows shell 命令映射为 Linux/WSL 命令。
 * 仅处理命令行开头的命令词，避免误替换参数或文件名中的文本。
 */
function mapCommandForPlatform(command: string): string {
  if (!isWSL() && process.platform !== 'linux') return command

  const mappings: Record<string, string> = {
    move: 'mv',
    copy: 'cp',
    del: 'rm',
    rename: 'mv',
    type: 'cat',
    dir: 'ls -la',
  }

  for (const [windowsCommand, linuxCommand] of Object.entries(mappings)) {
    const pattern = new RegExp(`^(\\s*)${windowsCommand}(?=\\s|$)`, 'i')
    if (pattern.test(command)) {
      return command.replace(pattern, `$1${linuxCommand}`)
    }
  }

  return command
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseJsonObject(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 统一在调用点记录日志，避免重复刷屏。
  }

  return {}
}

function createCompatAPIError(
  status: number,
  errorBody: object | undefined,
  message: string,
  headers: Headers,
): APIError {
  const APIErrorWithGenerate = APIError as typeof APIError & {
    generate?: (
      status: number | undefined,
      errorResponse: object | undefined,
      message: string | undefined,
      headers: Headers | undefined,
    ) => APIError
  }

  if (typeof APIErrorWithGenerate.generate === 'function') {
    return APIErrorWithGenerate.generate(status, errorBody, message, headers)
  }

  return new APIError(status, errorBody, message, headers)
}

function buildChatCompletionsURL(rawBaseURL: string): string {
  const baseURL = rawBaseURL.replace(/\/+$/, '')
  return baseURL.endsWith('/v1')
    ? `${baseURL}/chat/completions`
    : `${baseURL}/v1/chat/completions`
}

 /* 将 Anthropic 的消息内容（可能是字符串或内容块数组）转换为纯文本
 * 用于构建 OpenAI 消息时需要提取的用户/助手文本
 */
function contentToText(content: BetaMessageParam['content']): string {
  if (typeof content === 'string') return content

  return content
    .map(block => {
      if (block.type === 'text') return typeof block.text === 'string' ? block.text : ''

      if (block.type === 'tool_result') {
        return typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content)
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * 确保 content 以内容块数组的形式返回（若为字符串则包装为 text 块）
 */
function toBlocks(content: BetaMessageParam['content']): AnyBlock[] {
  return Array.isArray(content)
    ? (content as unknown as AnyBlock[])
    : [{ type: 'text', text: content }]
}

/**
 * 将 Anthropic 工具定义转换为 OpenAI 工具定义格式
 * 如果无工具或转换后为空，返回 undefined
 */
function getToolDefinitions(tools?: BetaToolUnion[]): OpenAIChatRequest['tools'] {
  if (!tools || tools.length === 0) return undefined

  const mapped = tools.flatMap(tool => {
    const record = tool as unknown as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : undefined
    if (!name) return []

    return [{
        type: 'function' as const,
        function: {
          name,
          description:
            typeof record.description === 'string' ? record.description : undefined,
          parameters: record.input_schema,
      },
    }]
  })

  return mapped.length > 0 ? mapped : undefined
}

/**
 * 将 Anthropic 格式的请求转换为 OpenAI 兼容的请求体
 * 会处理 system prompt、多模态内容、工具调用等字段的映射
 */
export function convertAnthropicRequestToOpenAI(input: {
  model: string
  system?: string | Array<{ type?: string; text?: string }>
  messages: BetaMessageParam[]
  tools?: BetaToolUnion[]
  tool_choice?: BetaToolChoiceAuto | BetaToolChoiceTool
  temperature?: number
  max_tokens?: number
}): OpenAIChatRequest {
  logForDebugging('[openaiCompat] 开始将 Anthropic 请求转换为 OpenAI 格式', { level: 'debug' })
  // 支持通过环境变量覆盖模型名称

  const configuredModel = process.env.ANTHROPIC_MODEL?.trim()
  const targetModel = configuredModel || input.model
  logForDebugging(`[openaiCompat] 目标模型: ${targetModel} (原始: ${input.model}, 环境覆盖: ${configuredModel ?? '无'})`, { level: 'debug' })
  const messages: OpenAIChatMessage[] = []

  logForDebugging(
    `[openaiCompat] 目标模型: ${targetModel} (原始: ${input.model}, 环境覆盖: ${configuredModel ?? '无'})`,
    { level: 'debug' },
  )

  if (input.system) {
    const systemText = Array.isArray(input.system)
      ? input.system.map(block => block.text ?? '').join('\n')
      : input.system

    if (systemText) {
      messages.push({ role: 'system', content: systemText })
      logForDebugging(`[openaiCompat] 添加 system 消息 (长度: ${systemText.length})`, {
        level: 'debug',
      })
    }
  }

  for (const message of input.messages) {
    logForDebugging(`[openaiCompat] 处理消息 role=${message.role}`, { level: 'debug' })

    if (message.role === 'user') {
      const blocks = toBlocks(message.content)
      const toolResults = blocks.filter(block => block.type === 'tool_result')

      for (const result of toolResults) {
        const toolUseId =
          typeof result.tool_use_id === 'string'
            ? result.tool_use_id
            : `toolu_missing_${messages.length}`
        const content = result.content
        const toolContent =
          typeof content === 'string' ? content : JSON.stringify(content ?? '')

        messages.push({
          role: 'tool',
          tool_call_id: toolUseId,
          content: toolContent,
        })

        logForDebugging(
          `[openaiCompat] 添加 tool 消息 (tool_use_id=${toolUseId}, content长度=${toolContent.length})`,
          { level: 'debug' },
        )
      }

      const text = contentToText(
        blocks.filter(block => block.type !== 'tool_result') as unknown as BetaMessageParam['content'],
      )

      if (text) {
        messages.push({ role: 'user', content: text })
        logForDebugging(`[openaiCompat] 添加 user 消息 (长度: ${text.length})`, {
          level: 'debug',
        })
      }

      continue
    }

    if (message.role === 'assistant') {
      const blocks = toBlocks(message.content)
      const text = blocks
        .filter(block => block.type === 'text')
        .map(block => (typeof block.text === 'string' ? block.text : ''))
        .join('')

      const toolCalls = blocks
        .filter(block => block.type === 'tool_use')
        .map(block => ({
          id: typeof block.id === 'string' ? block.id : `toolu_missing_${messages.length}`,
          type: 'function' as const,
          function: {
            name: typeof block.name === 'string' ? block.name : '',
            arguments:
              typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
          },
        }))

      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })

      logForDebugging(
        `[openaiCompat] 添加 assistant 消息 (text长度=${text.length}, toolCalls数量=${toolCalls.length})`,
        { level: 'debug' },
      )
    }
  }

  const toolDefinitions = getToolDefinitions(input.tools)

  const result: OpenAIChatRequest = {
    model: targetModel,
    messages,
    temperature: input.temperature,
    max_tokens: input.max_tokens,
    ...(getToolDefinitions(input.tools)
      ? { tools: getToolDefinitions(input.tools) }
      : {}),
    ...(input.tool_choice?.type === 'tool'
      ? {
          tool_choice: {
            type: 'function' as const,
            function: { name: input.tool_choice.name },
          },
        }
      : input.tool_choice?.type === 'auto'
        ? { tool_choice: 'auto' as const }
        : {}),
  }

  logForDebugging(`[openaiCompat] 转换完成: 模型: ${targetModel}，总消息数=${messages.length}, 工具数=${result.tools?.length ?? 0}`, { level: 'debug' })

  return result
}

/**
 * 向 OpenAI 兼容端点发起流式 POST 请求。
 */
export async function createOpenAICompatStream(
  config: OpenAICompatConfig,
  request: OpenAIChatRequest,
  signal: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const url = buildChatCompletionsURL(config.baseURL)

  logForDebugging(`[openaiCompat] 准备请求 URL: ${url}`, { level: 'debug' })
  logForDebugging(
    `[openaiCompat] 请求体: ${JSON.stringify({ ...request, stream: true })}`,
    { level: 'debug' },
  )

  const response = await (config.fetch ?? globalThis.fetch)(url, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
      ...config.headers,
    },
    body: JSON.stringify({ ...request, stream: true }),
  })

  if (!response.ok || !response.body) {
    let responseText = ''
    try {
      responseText = await response.text()
    } catch {
      responseText = ''
    }

    logForDebugging(
      `[openaiCompat] 响应错误: status=${response.status}, body=${responseText}`,
      { level: 'debug' },
    )

    const message =
      `OpenAI compat request failed with status ${response.status}` +
      (responseText ? `: ${responseText}` : '')

    if (response.status === 429 || response.status === 529 || response.status >= 500) {
      let errorBody: object | undefined
      try {
        errorBody = JSON.parse(responseText)
      } catch {
        errorBody = { message: responseText }
      }

      throw createCompatAPIError(
        response.status,
        errorBody,
        message,
        new Headers(response.headers as HeadersInit),
      )
    }

    throw new Error(`${message}. 请确认服务端返回的是有效的 OpenAI 格式响应。`)
  }

  logForDebugging(`[openaiCompat] 请求成功, 状态码=${response.status}, 准备读取流`, {
    level: 'debug',
  })

  return response.body.getReader()
}

/**
 * 按 SSE 空行分割事件。
 */
function parseSSEChunk(buffer: string): { events: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  return { events: parts, remainder }
}

/**
 * 提取一个 SSE 事件中的 data 字段。
 * 多个 data: 行必须用换行拼接后再解析。
 */
function getSSEData(rawEvent: string): string {
  return rawEvent
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
}

/**
 * 将 OpenAI finish_reason 映射为 Anthropic stop_reason。
 */
function mapFinishReason(reason: string | null | undefined): BetaMessage['stop_reason'] {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}

/**
 * 解析兼容服务错误事件。
 */
function throwNativeStreamError(event: Record<string, unknown>): never {
  const rawError = event.error
  const streamError =
    rawError && typeof rawError === 'object'
      ? (rawError as Record<string, unknown>)
      : event
  const errorType = typeof streamError.type === 'string' ? streamError.type : ''
  const message =
    typeof streamError.message === 'string'
      ? streamError.message
      : 'Anthropic-compatible stream returned an error event'

  const status = errorType === 'rate_limit_error' ? 429 : errorType === 'overloaded_error' ? 529 : 500

  throw createCompatAPIError(status, { error: streamError }, message, new Headers())
}

/**
 * 将非流式响应转换成 Anthropic 事件和最终 Message。
 */
function tryParseNonStreamingResponse(
  raw: string,
  model: string,
): {
  promptTokens: number
  completionTokens: number
  events: BetaRawMessageStreamEvent[]
  resultMessage: BetaMessage
} | null {
  let parsed: Record<string, unknown>

  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null

  // OpenAI 格式：{ choices: [{ message, finish_reason }], usage }
  if (Array.isArray(parsed.choices) || parsed.object === 'chat.completion') {
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined
    const choice = choices?.[0]
    const message = choice?.message as Record<string, unknown> | undefined
    const finishReason = choice?.finish_reason as string | null | undefined
    const usage = parsed.usage as Record<string, unknown> | undefined
    const promptTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0
    const completionTokens =
      typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0
    const events: BetaRawMessageStreamEvent[] = []
    const finalContent: AnyBlock[] = []
    let nextIndex = 0

    events.push({
      type: 'message_start',
      message: {
        id: typeof parsed.id === 'string' ? parsed.id : 'openai-compat',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: promptTokens, output_tokens: 0 },
      },
    } as BetaRawMessageStreamEvent)

    const content = typeof message?.content === 'string' ? message.content : ''
    if (content) {
      const index = nextIndex++
      finalContent.push({ type: 'text', text: content })
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      } as BetaRawMessageStreamEvent)
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: content },
      } as BetaRawMessageStreamEvent)
      events.push({ type: 'content_block_stop', index } as BetaRawMessageStreamEvent)
    }

    const toolCalls = Array.isArray(message?.tool_calls)
      ? (message.tool_calls as Array<Record<string, unknown>>)
      : []

    for (const toolCall of toolCalls) {
      const index = nextIndex++
      const fn =
        toolCall.function && typeof toolCall.function === 'object'
          ? (toolCall.function as Record<string, unknown>)
          : {}
      const argumentsJson = typeof fn.arguments === 'string' ? fn.arguments : '{}'
      const input = parseJsonObject(argumentsJson)
      const id = typeof toolCall.id === 'string' ? toolCall.id : `toolu_${index}`
      const name = typeof fn.name === 'string' ? fn.name : ''

      finalContent.push({ type: 'tool_use', id, name, input })
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id, name, input: {} },
      } as BetaRawMessageStreamEvent)
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: argumentsJson },
      } as BetaRawMessageStreamEvent)
      events.push({ type: 'content_block_stop', index } as BetaRawMessageStreamEvent)
    }

    const stopReason = mapFinishReason(finishReason ?? 'stop')
    events.push({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: completionTokens },
    } as BetaRawMessageStreamEvent)

    return {
      promptTokens,
      completionTokens,
      events,
      resultMessage: {
        id: typeof parsed.id === 'string' ? parsed.id : 'openai-compat',
        type: 'message',
        role: 'assistant',
        model,
        content: finalContent as any,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: promptTokens, output_tokens: completionTokens },
      } as BetaMessage,
    }
  }

  // Anthropic 原生非流式格式。
  if (parsed.type === 'message' && Array.isArray(parsed.content)) {
    const blocks = parsed.content as Array<Record<string, unknown>>
    const usage = parsed.usage as Record<string, unknown> | undefined
    const stopReason = parsed.stop_reason as BetaMessage['stop_reason']
    const promptTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0
    const completionTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0
    const events: BetaRawMessageStreamEvent[] = []

    events.push({
      type: 'message_start',
      message: {
        id: typeof parsed.id === 'string' ? parsed.id : 'anthropic-native',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: promptTokens, output_tokens: 0 },
      },
    } as BetaRawMessageStreamEvent)

    blocks.forEach((block, index) => {
      if (block.type === 'text') {
        const text = typeof block.text === 'string' ? block.text : ''
        events.push({
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        } as BetaRawMessageStreamEvent)
        if (text) {
          events.push({
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text },
          } as BetaRawMessageStreamEvent)
        }
        events.push({ type: 'content_block_stop', index } as BetaRawMessageStreamEvent)
        return
      }

      if (block.type === 'tool_use') {
        const input =
          block.input && typeof block.input === 'object' && !Array.isArray(block.input)
            ? (block.input as Record<string, unknown>)
            : {}
        const partialJson = JSON.stringify(input)
        events.push({
          type: 'content_block_start',
          index,
          content_block: {
            type: 'tool_use',
            id: typeof block.id === 'string' ? block.id : `toolu_${index}`,
            name: typeof block.name === 'string' ? block.name : '',
            input: {},
          },
        } as BetaRawMessageStreamEvent)
        events.push({
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: partialJson },
        } as BetaRawMessageStreamEvent)
        events.push({ type: 'content_block_stop', index } as BetaRawMessageStreamEvent)
        return
      }

      // 对未知块保守透传，避免未来新增块导致崩溃。
      events.push({
        type: 'content_block_start',
        index,
        content_block: block,
      } as BetaRawMessageStreamEvent)
      events.push({ type: 'content_block_stop', index } as BetaRawMessageStreamEvent)
    })

    events.push({
      type: 'message_delta',
      delta: { stop_reason: stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: completionTokens },
    } as BetaRawMessageStreamEvent)

    return {
      promptTokens,
      completionTokens,
      events,
      resultMessage: parsed as unknown as BetaMessage,
    }
  }

  return null
}

/**
 * 将 OpenAI 兼容 SSE 流转换为 Anthropic BetaRawMessageStreamEvent。
 *
 * 支持：
 * 1. OpenAI Chat Completions SSE；
 * 2. OpenAI 非流式 JSON 回退；
 * 3. Anthropic 原生 SSE 透传与累积；
 * 4. 文本形式工具调用的兼容提取。
 */
export async function* createAnthropicStreamFromOpenAI(input: {
  reader: ReadableStreamDefaultReader<Uint8Array>
  model: string
}): AsyncGenerator<BetaRawMessageStreamEvent, BetaMessage, void> {
  const decoder = new TextDecoder()
  let buffer = ''
  let reachedEOF = false
  let started = false
  let streamMode: 'unknown' | 'openai' | 'anthropic' = 'unknown'
  let nextContentIndex = 0
  let promptTokens = 0
  let completionTokens = 0
  let responseBytes = 0
  let openAIStopReason: BetaMessage['stop_reason'] | null = null
  let nativeStopReason: BetaMessage['stop_reason'] | null = null
  let nativeMessageDeltaSent = false
  let messageId = 'openai-compat'

  const finalBlocks = new Map<number, AnyBlock>()

  const toolExtractor = new ToolCallExtractor({
    // 默认关闭，避免把模型正常展示的 bash 示例误当成真实工具调用。
    // 如确实依赖旧模型输出 bash 代码块触发执行，可显式开启环境变量。
    enableBashCodeBlock: process.env.OPENAI_COMPAT_EXTRACT_BASH_CODE_BLOCK === 'true',
    enableBareCommandLine: process.env.OPENAI_COMPAT_EXTRACT_BARE_COMMAND === 'true',
  })

  let activeTextIndex: number | null = null
  const openAIToolStates = new Map<number, OpenAIToolStreamState>()

  const nativeIndexMap = new Map<number, number>()
  const nativeOpenBlocks = new Set<number>()
  const nativeBlockStates = new Map<number, NativeBlockState>()

  logForDebugging(`[openaiCompat] 开始转换响应流, model=${input.model}`, {
    level: 'debug',
  })

  function appendFinalText(index: number, text: string): void {
    const block = finalBlocks.get(index)
    if (block?.type === 'text') {
      block.text = String(block.text ?? '') + text
      return
    }

    finalBlocks.set(index, { type: 'text', text })
  }

  function buildFinalContent(): AnyBlock[] {
    return [...finalBlocks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, block]) => block)
  }

  async function* closeActiveTextBlock(): AsyncGenerator<BetaRawMessageStreamEvent, void, void> {
    if (activeTextIndex === null) return

    yield {
      type: 'content_block_stop',
      index: activeTextIndex,
    } as BetaRawMessageStreamEvent

    activeTextIndex = null
  }

  async function* emitText(text: string): AsyncGenerator<BetaRawMessageStreamEvent, void, void> {
    if (!text) return

    if (activeTextIndex === null) {
      activeTextIndex = nextContentIndex++
      finalBlocks.set(activeTextIndex, { type: 'text', text: '' })

      yield {
        type: 'content_block_start',
        index: activeTextIndex,
        content_block: { type: 'text', text: '' },
      } as BetaRawMessageStreamEvent
    }

    appendFinalText(activeTextIndex, text)

    yield {
      type: 'content_block_delta',
      index: activeTextIndex,
      delta: { type: 'text_delta', text },
    } as BetaRawMessageStreamEvent
  }

  async function* emitSyntheticToolCall(
    toolCall: ToolCall,
  ): AsyncGenerator<BetaRawMessageStreamEvent, void, void> {
    yield* closeActiveTextBlock()

    const index = nextContentIndex++
    const parsedInput = parseJsonObject(toolCall.function.arguments)

    if (toolCall.function.arguments.trim() && Object.keys(parsedInput).length === 0) {
      logForDebugging(
        `[openaiCompat] 文本工具调用参数无法解析为 JSON 对象: name=${toolCall.function.name}, args=${toolCall.function.arguments.slice(0, 300)}`,
        { level: 'debug' },
      )
    }

    finalBlocks.set(index, {
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: parsedInput,
    })

    yield {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: {},
      },
    } as BetaRawMessageStreamEvent

    if (toolCall.function.arguments) {
      yield {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'input_json_delta',
          partial_json: toolCall.function.arguments,
        },
      } as BetaRawMessageStreamEvent
    }

    yield { type: 'content_block_stop', index } as BetaRawMessageStreamEvent
  }

  async function* emitExtractorResult(
    result: ExtractResult,
  ): AsyncGenerator<BetaRawMessageStreamEvent, void, void> {
    if (result.text) {
      yield* emitText(result.text)
    }

    for (const toolCall of result.toolCalls) {
      yield* emitSyntheticToolCall(toolCall)
    }
  }

  function appendToolName(state: OpenAIToolStreamState, namePart: string | undefined): void {
    if (!namePart) return
    if (!state.name) {
      state.name = namePart
      return
    }
    if (state.name === namePart || state.name.endsWith(namePart)) return
    state.name += namePart
  }

  async function* ensureOpenAIToolStarted(
    state: OpenAIToolStreamState,
    force = false,
  ): AsyncGenerator<BetaRawMessageStreamEvent, void, void> {
    if (state.started) return
    if (!force && !state.name) return

    yield* closeActiveTextBlock()

    const index = nextContentIndex++
    state.anthropicIndex = index
    state.started = true

    finalBlocks.set(index, {
      type: 'tool_use',
      id: state.id,
      name: state.name,
      input: {},
    })

    yield {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: state.id,
        name: state.name,
        input: {},
      },
    } as BetaRawMessageStreamEvent

    for (const partialJson of state.queuedArgumentDeltas) {
      yield {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: partialJson },
      } as BetaRawMessageStreamEvent
    }

    state.queuedArgumentDeltas = []
  }

  async function* closeOpenAIToolState(
    state: OpenAIToolStreamState,
  ): AsyncGenerator<BetaRawMessageStreamEvent, void, void> {
    if (state.closed) return

    yield* ensureOpenAIToolStarted(state, true)

    if (state.anthropicIndex === undefined) return

    const inputObject = parseJsonObject(state.arguments)
    if (state.arguments.trim() && Object.keys(inputObject).length === 0) {
      logForDebugging(
        `[openaiCompat] OpenAI 原生工具参数无法解析为 JSON 对象: name=${state.name}, args=${state.arguments.slice(0, 300)}`,
        { level: 'debug' },
      )
    }

    finalBlocks.set(state.anthropicIndex, {
      type: 'tool_use',
      id: state.id,
      name: state.name,
      input: inputObject,
    })

    yield {
      type: 'content_block_stop',
      index: state.anthropicIndex,
    } as BetaRawMessageStreamEvent

    state.closed = true
  }

  async function* closeAllOpenAIToolStates(): AsyncGenerator<
    BetaRawMessageStreamEvent,
    void,
    void
  > {
    for (const state of [...openAIToolStates.values()].sort(
      (left, right) => left.openAIIndex - right.openAIIndex,
    )) {
      yield* closeOpenAIToolState(state)
    }
  }

  async function* finalizeOpenAIStream(): AsyncGenerator<
    BetaRawMessageStreamEvent,
    BetaMessage,
    void
  > {
    if (!started) {
      throw new Error(`[openaiCompat] 未收到 message_start 事件，模型: ${input.model}`)
    }

    const flushResult = toolExtractor.flush()
    yield* emitExtractorResult(flushResult)
    yield* closeActiveTextBlock()
    yield* closeAllOpenAIToolStates()

    const finalContent = buildFinalContent()
    const containsTools = finalContent.some(block => block.type === 'tool_use')
    const stopReason = openAIStopReason ?? (containsTools ? 'tool_use' : 'end_turn')

    yield {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: completionTokens },
    } as BetaRawMessageStreamEvent

    yield { type: 'message_stop' } as BetaRawMessageStreamEvent

    _lastResponseBytes = responseBytes

    logForDebugging(
      `[openaiCompat] OpenAI 流结束: input=${promptTokens}, output=${completionTokens}, bytes=${responseBytes}`,
      { level: 'debug' },
    )

    return {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model: input.model,
      content: finalContent as any,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: promptTokens, output_tokens: completionTokens },
    } as BetaMessage
  }

  async function* closeAllNativeBlocks(): AsyncGenerator<
    BetaRawMessageStreamEvent,
    void,
    void
  > {
    for (const anthropicIndex of [...nativeOpenBlocks].sort((left, right) => left - right)) {
      const state = nativeBlockStates.get(anthropicIndex)
      if (state?.kind === 'tool_use') {
        const parsedInput = state.partialJson
          ? parseJsonObject(state.partialJson)
          : state.input
        finalBlocks.set(anthropicIndex, {
          type: 'tool_use',
          id: state.id,
          name: state.name,
          input: parsedInput,
        })
      }

      yield { type: 'content_block_stop', index: anthropicIndex } as BetaRawMessageStreamEvent
    }

    nativeOpenBlocks.clear()
    nativeIndexMap.clear()
  }

  async function* finalizeNativeStream(): AsyncGenerator<
    BetaRawMessageStreamEvent,
    BetaMessage,
    void
  > {
    yield* closeAllNativeBlocks()

    const stopReason = nativeStopReason ?? 'end_turn'

    if (!nativeMessageDeltaSent) {
      yield {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: completionTokens },
      } as BetaRawMessageStreamEvent
    }

    yield { type: 'message_stop' } as BetaRawMessageStreamEvent

    _lastResponseBytes = responseBytes

    return {
      id: messageId || 'anthropic-native',
      type: 'message',
      role: 'assistant',
      model: input.model,
      content: buildFinalContent() as any,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: promptTokens, output_tokens: completionTokens },
    } as BetaMessage
  }

  while (!reachedEOF) {
    const { done, value } = await input.reader.read()

    if (done) {
      buffer += decoder.decode()
      reachedEOF = true
    } else {
      if (value?.byteLength) responseBytes += value.byteLength
      buffer += decoder.decode(value, { stream: true })
    }

    const sse = parseSSEChunk(buffer)
    buffer = sse.remainder
    const rawEvents = [...sse.events]

    // 某些服务最后一个 SSE 事件没有双换行，EOF 时补处理。
    if (reachedEOF && buffer.trimStart().startsWith('data:')) {
      rawEvents.push(buffer)
      buffer = ''
    }

    for (const rawEvent of rawEvents) {
      const data = getSSEData(rawEvent)
      if (!data) continue

      if (data === '[DONE]') {
        logForDebugging('[openaiCompat] 收到 [DONE]', { level: 'debug' })

        if (streamMode === 'anthropic') {
          return yield* finalizeNativeStream()
        }

        return yield* finalizeOpenAIStream()
      }

      let event: Record<string, unknown>
      try {
        event = JSON.parse(data) as Record<string, unknown>
      } catch {
        logForDebugging(`[openaiCompat] 无法解析 SSE data: ${data.slice(0, 300)}`, {
          level: 'debug',
        })
        continue
      }

      logForDebugging(`[openaiCompat] 收到事件: ${JSON.stringify(event).slice(0, 500)}`, {
        level: 'debug',
      })

      // OpenAI include_usage 最后的 chunk 可以是 choices: []。
      if (Array.isArray(event.choices) && event.choices.length === 0) {
        const usage = event.usage as Record<string, unknown> | undefined
        if (typeof usage?.prompt_tokens === 'number') promptTokens = usage.prompt_tokens
        if (typeof usage?.completion_tokens === 'number') {
          completionTokens = usage.completion_tokens
        }
        continue
      }

      const hasChoices = Array.isArray(event.choices) && event.choices.length > 0

      // ===============================
      // Anthropic 原生 SSE 路径
      // ===============================
      if (!hasChoices) {
        const eventType = typeof event.type === 'string' ? event.type : ''
        if (!eventType) continue

        streamMode = 'anthropic'

        switch (eventType) {
          case 'ping': {
            yield event as unknown as BetaRawMessageStreamEvent
            break
          }

          case 'error': {
            throwNativeStreamError(event)
          }

          case 'message_start': {
            started = true
            const originalMessage =
              event.message && typeof event.message === 'object'
                ? ({ ...(event.message as Record<string, unknown>) } as Record<string, unknown>)
                : {}
            const usage =
              originalMessage.usage && typeof originalMessage.usage === 'object'
                ? (originalMessage.usage as Record<string, unknown>)
                : undefined

            if (typeof originalMessage.id === 'string') messageId = originalMessage.id
            if (typeof usage?.input_tokens === 'number') promptTokens = usage.input_tokens

            originalMessage.id = messageId || 'anthropic-native'
            originalMessage.type = 'message'
            originalMessage.role = 'assistant'
            originalMessage.model = originalMessage.model || input.model
            originalMessage.content = []
            originalMessage.stop_reason = null
            originalMessage.stop_sequence = null
            originalMessage.usage = {
              input_tokens: promptTokens,
              output_tokens: 0,
            }

            yield {
              type: 'message_start',
              message: originalMessage,
            } as BetaRawMessageStreamEvent
            break
          }

          case 'content_block_start': {
            const upstreamIndex = Number(event.index) || 0
            let anthropicIndex = nativeIndexMap.get(upstreamIndex)
            if (anthropicIndex === undefined) {
              anthropicIndex = nextContentIndex++
              nativeIndexMap.set(upstreamIndex, anthropicIndex)
            }

            const block =
              event.content_block && typeof event.content_block === 'object'
                ? (event.content_block as Record<string, unknown>)
                : {}

            nativeOpenBlocks.add(anthropicIndex)

            if (block.type === 'tool_use') {
              const id = typeof block.id === 'string' ? block.id : `toolu_${anthropicIndex}`
              const name = typeof block.name === 'string' ? block.name : ''
              const initialInput =
                block.input && typeof block.input === 'object' && !Array.isArray(block.input)
                  ? (block.input as Record<string, unknown>)
                  : {}

              nativeBlockStates.set(anthropicIndex, {
                kind: 'tool_use',
                anthropicIndex,
                id,
                name,
                input: initialInput,
                partialJson: '',
              })
              finalBlocks.set(anthropicIndex, { type: 'tool_use', id, name, input: initialInput })

              yield {
                type: 'content_block_start',
                index: anthropicIndex,
                content_block: { type: 'tool_use', id, name, input: {} },
              } as BetaRawMessageStreamEvent
              break
            }

            // 与原逻辑一致：thinking 对 UI 映射为文本块。
            nativeBlockStates.set(anthropicIndex, {
              kind: 'text',
              anthropicIndex,
              text: '',
            })
            finalBlocks.set(anthropicIndex, { type: 'text', text: '' })

            yield {
              type: 'content_block_start',
              index: anthropicIndex,
              content_block: { type: 'text', text: '' },
            } as BetaRawMessageStreamEvent
            break
          }

          case 'content_block_delta': {
            const upstreamIndex = Number(event.index) || 0
            let anthropicIndex = nativeIndexMap.get(upstreamIndex)
            const delta =
              event.delta && typeof event.delta === 'object'
                ? (event.delta as Record<string, unknown>)
                : {}

            if (delta.type === 'signature_delta') {
              // UI 不展示签名，但保留流稳定性。
              break
            }

            if (anthropicIndex === undefined) {
              anthropicIndex = nextContentIndex++
              nativeIndexMap.set(upstreamIndex, anthropicIndex)
              nativeOpenBlocks.add(anthropicIndex)

              if (delta.type === 'input_json_delta') {
                const id = typeof delta.id === 'string' ? delta.id : `toolu_${anthropicIndex}`
                const name = typeof delta.name === 'string' ? delta.name : ''
                nativeBlockStates.set(anthropicIndex, {
                  kind: 'tool_use',
                  anthropicIndex,
                  id,
                  name,
                  input: {},
                  partialJson: '',
                })
                finalBlocks.set(anthropicIndex, { type: 'tool_use', id, name, input: {} })

                yield {
                  type: 'content_block_start',
                  index: anthropicIndex,
                  content_block: { type: 'tool_use', id, name, input: {} },
                } as BetaRawMessageStreamEvent
              } else {
                nativeBlockStates.set(anthropicIndex, {
                  kind: 'text',
                  anthropicIndex,
                  text: '',
                })
                finalBlocks.set(anthropicIndex, { type: 'text', text: '' })

                yield {
                  type: 'content_block_start',
                  index: anthropicIndex,
                  content_block: { type: 'text', text: '' },
                } as BetaRawMessageStreamEvent
              }
            }

            const state = nativeBlockStates.get(anthropicIndex)

            if (state?.kind === 'tool_use' && delta.type === 'input_json_delta') {
              const partialJson = typeof delta.partial_json === 'string' ? delta.partial_json : ''
              state.partialJson += partialJson

              yield {
                type: 'content_block_delta',
                index: anthropicIndex,
                delta: { type: 'input_json_delta', partial_json: partialJson },
              } as BetaRawMessageStreamEvent
              break
            }

            const text =
              delta.type === 'thinking_delta'
                ? typeof delta.thinking === 'string'
                  ? delta.thinking
                  : ''
                : typeof delta.text === 'string'
                  ? delta.text
                  : ''

            if (text) {
              if (state?.kind === 'text') state.text += text
              appendFinalText(anthropicIndex, text)

              yield {
                type: 'content_block_delta',
                index: anthropicIndex,
                delta: { type: 'text_delta', text },
              } as BetaRawMessageStreamEvent
            }
            break
          }

          case 'content_block_stop': {
            const upstreamIndex = Number(event.index) || 0
            const anthropicIndex = nativeIndexMap.get(upstreamIndex)
            if (anthropicIndex === undefined) break

            const state = nativeBlockStates.get(anthropicIndex)
            if (state?.kind === 'tool_use') {
              const parsedInput = state.partialJson
                ? parseJsonObject(state.partialJson)
                : state.input
              finalBlocks.set(anthropicIndex, {
                type: 'tool_use',
                id: state.id,
                name: state.name,
                input: parsedInput,
              })
            }

            nativeOpenBlocks.delete(anthropicIndex)
            nativeIndexMap.delete(upstreamIndex)

            yield { type: 'content_block_stop', index: anthropicIndex } as BetaRawMessageStreamEvent
            break
          }

          case 'message_delta': {
            const usage =
              event.usage && typeof event.usage === 'object'
                ? (event.usage as Record<string, unknown>)
                : undefined
            const delta =
              event.delta && typeof event.delta === 'object'
                ? (event.delta as Record<string, unknown>)
                : {}

            if (typeof usage?.output_tokens === 'number') {
              completionTokens = usage.output_tokens
            }
            if (typeof delta.stop_reason === 'string') {
              nativeStopReason = delta.stop_reason as BetaMessage['stop_reason']
            }

            nativeMessageDeltaSent = true

            yield {
              type: 'message_delta',
              delta: {
                ...delta,
                stop_reason: nativeStopReason,
                stop_sequence: delta.stop_sequence ?? null,
              },
              usage: { output_tokens: completionTokens },
            } as BetaRawMessageStreamEvent
            break
          }

          case 'message_stop': {
            return yield* finalizeNativeStream()
          }

          default: {
            logForDebugging(`[openaiCompat] 忽略未知 Anthropic SSE 事件: ${eventType}`, {
              level: 'debug',
            })
          }
        }

        continue
      }

      // ===============================
      // OpenAI choices SSE 路径
      // ===============================
      streamMode = 'openai'
      const chunk = event as unknown as OpenAIStreamChunk
      const choice = chunk.choices?.[0]

      // 部分兼容服务在 SSE data 中返回完整非流式 chat.completion。
      if (choice?.message && !choice.delta) {
        const parsed = tryParseNonStreamingResponse(data, input.model)
        if (parsed) {
          promptTokens = parsed.promptTokens
          completionTokens = parsed.completionTokens
          for (const parsedEvent of parsed.events) yield parsedEvent
          _lastResponseBytes = responseBytes
          yield { type: 'message_stop' } as BetaRawMessageStreamEvent
          return parsed.resultMessage
        }
      }

      const delta = choice?.delta

      if (!started) {
        started = true
        messageId = chunk.id ?? 'openai-compat'
        promptTokens = chunk.usage?.prompt_tokens ?? promptTokens

        yield {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model: input.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: promptTokens, output_tokens: 0 },
          },
        } as BetaRawMessageStreamEvent
      }

      if (typeof chunk.usage?.prompt_tokens === 'number') {
        promptTokens = chunk.usage.prompt_tokens
      }
      if (typeof chunk.usage?.completion_tokens === 'number') {
        completionTokens = chunk.usage.completion_tokens
      }

      if (typeof delta?.content === 'string' && delta.content) {
        yield* emitExtractorResult(toolExtractor.extract(delta.content))
      }

      // 某些兼容端点使用 thinking 字段；保持原逻辑，将其映射为可见文本。
      if (typeof delta?.thinking === 'string' && delta.thinking) {
        yield* emitText(delta.thinking)
      }

      if (Array.isArray(delta?.tool_calls)) {
        yield* closeActiveTextBlock()

        for (const toolCallDelta of delta.tool_calls) {
          const openAIIndex = toolCallDelta.index ?? 0
          let state = openAIToolStates.get(openAIIndex)

          if (!state) {
            state = {
              openAIIndex,
              id: toolCallDelta.id ?? `toolu_${openAIIndex}`,
              name: '',
              arguments: '',
              queuedArgumentDeltas: [],
              started: false,
              closed: false,
            }
            openAIToolStates.set(openAIIndex, state)
          }

          // content_block_start 发出后不能再修改 id，因此只在开始前吸收后续 id。
          if (!state.started && toolCallDelta.id) state.id = toolCallDelta.id
          appendToolName(state, toolCallDelta.function?.name)

          const argumentsDelta = toolCallDelta.function?.arguments
          if (typeof argumentsDelta === 'string' && argumentsDelta) {
            state.arguments += argumentsDelta

            if (state.started && state.anthropicIndex !== undefined) {
              yield {
                type: 'content_block_delta',
                index: state.anthropicIndex,
                delta: { type: 'input_json_delta', partial_json: argumentsDelta },
              } as BetaRawMessageStreamEvent
            } else {
              state.queuedArgumentDeltas.push(argumentsDelta)
              yield* ensureOpenAIToolStarted(state)
            }
          }
        }
      }

      if (choice?.finish_reason) {
        openAIStopReason = mapFinishReason(choice.finish_reason)
        logForDebugging(`[openaiCompat] 收到 finish_reason=${choice.finish_reason}`, {
          level: 'debug',
        })
      }
    }
  }

  // 非流式 JSON 回退。
  if (streamMode === 'unknown' && buffer.trim()) {
    const parsed = tryParseNonStreamingResponse(buffer.trim(), input.model)
    if (parsed) {
      for (const event of parsed.events) yield event
      _lastResponseBytes = responseBytes
      yield { type: 'message_stop' } as BetaRawMessageStreamEvent
      return parsed.resultMessage
    }
  }

  // 某些 OpenAI 兼容服务不会发送 [DONE]，EOF 时正常收尾。
  if (streamMode === 'openai') {
    return yield* finalizeOpenAIStream()
  }

  if (streamMode === 'anthropic') {
    throw new Error(`[openaiCompat] 原生 Anthropic 流在收到 message_stop 前结束，模型: ${input.model}`)
  }

  throw new Error(`[openaiCompat] 未收到有效响应事件，模型: ${input.model}`)
}

// 记录最近一次 OpenAI 兼容请求的响应字节数，供外部监控使用。
let _lastResponseBytes = 0

export function getLastResponseBytes(): number {
  return _lastResponseBytes
}

/**
 * 将 OpenAI usage 映射为 Anthropic BetaUsage。
 */
export function mapOpenAIUsageToAnthropic(usage?: {
  prompt_tokens?: number
  completion_tokens?: number
}): BetaUsage | undefined {
  if (!usage) return undefined

  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  } as BetaUsage
}

// ================== 文本工具调用提取器 ==================

export type ToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type ExtractResult = {
  text: string
  toolCalls: ToolCall[]
  remaining: string
}

export type ToolCallExtractorOptions = {
  /** 是否将 bash/cmd 代码块解释为工具执行。默认 false，避免误吞代码示例。 */
  enableBashCodeBlock?: boolean
  /** 是否将裸命令行解释为工具执行。默认 false，避免误吞普通文本。 */
  enableBareCommandLine?: boolean
}

/**
 * 从模型文本中兼容提取工具调用。
 *
 * 设计原则：
 * 1. 标准 OpenAI delta.tool_calls 优先由流转换器直接处理；
 * 2. 本类只承担旧模型和代理服务输出文本协议时的兼容；
 * 3. 只有仍可能补全为工具协议的尾部会暂存，不再因为普通 Tool:/Action: 文本阻塞 UI；
 * 4. flush() 不静默丢弃文本。
 */
export class ToolCallExtractor {
  private buffer = ''
  private emittedTextLen = 0
  private toolCallCounter = 0
  private readonly emittedToolKeys = new Set<string>()

  constructor(private readonly opts: ToolCallExtractorOptions = {}) {}

  private generateId(): string {
    return Math.random().toString(36).slice(2, 10)
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map(item => this.stableStringify(item)).join(',')}]`
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      return `{${Object.keys(record)
        .sort()
        .map(key => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`)
        .join(',')}}`
    }

    return JSON.stringify(value)
  }

  private normalizeToolName(name: string): string {
    const base = name.includes(':') ? name.split(':').pop() || name : name
    const mapping: Record<string, string> = {
      bash: 'Bash',
      cmd: 'Bash',
      shell: 'Bash',
      powershell: 'Bash',
      batch: 'Bash',
      glob: 'Glob',
      find: 'Glob',
      read: 'Read',
      cat: 'Read',
      grep: 'Grep',
      findstr: 'Grep',
      write: 'Write',
      edit: 'Edit',
      ls: 'ListFiles',
      dir: 'ListFiles',
      listfiles: 'ListFiles',
      web_search: 'WebSearch',
      websearch: 'WebSearch',
      code_interpreter: 'CodeInterpreter',
      codeinterpreter: 'CodeInterpreter',
      web_extractor: 'WebExtractor',
      webextractor: 'WebExtractor',
      str_replace_editor: 'StrReplaceEditor',
      strreplaceeditor: 'StrReplaceEditor',
    }

    const lower = base.toLowerCase()
    return mapping[lower] ?? `${base.charAt(0).toUpperCase()}${base.slice(1)}`
  }

  private normalizeArgsForKey(toolCall: ToolCall): string {
    const normalizedName = this.normalizeToolName(toolCall.function.name).toLowerCase()

    try {
      const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>

      if (normalizedName === 'listfiles') {
        return `directory=${String(args.directory ?? args.dir ?? args.path ?? args.filePath ?? '.')}`
      }

      if (normalizedName === 'glob') {
        return `pattern=${String(args.pattern ?? args.name ?? '')};path=${String(args.path ?? '')}`
      }

      if (normalizedName === 'bash') {
        return `command=${String(args.command ?? args.cmd ?? '')}`
      }

      return this.stableStringify(args)
    } catch {
      return toolCall.function.arguments
    }
  }

  private getToolCallKey(toolCall: ToolCall): string {
    return `${this.normalizeToolName(toolCall.function.name).toLowerCase()}:${this.normalizeArgsForKey(toolCall)}`
  }

  private addIfNew(toolCall: ToolCall): ToolCall[] {
    const key = this.getToolCallKey(toolCall)
    if (this.emittedToolKeys.has(key)) {
      logForDebugging(`[ToolCallExtractor] 跳过重复工具调用: ${key}`, { level: 'debug' })
      return []
    }

    this.emittedToolKeys.add(key)
    logForDebugging(`[ToolCallExtractor] 提取工具调用: ${key}`, { level: 'debug' })
    return [toolCall]
  }

  private makeToolCall(name: string, args: unknown): ToolCall {
    const normalizedName = this.normalizeToolName(name)
    let finalArgs = args

    if (normalizedName === 'Bash' && finalArgs && typeof finalArgs === 'object') {
      const record = finalArgs as Record<string, unknown>
      const command = record.command ?? record.cmd
      if (command !== undefined) {
        finalArgs = { command: mapCommandForPlatform(String(command)) }
      }
    }

    const toolCall: ToolCall = {
      id: `call_${this.generateId()}_${++this.toolCallCounter}`,
      type: 'function',
      function: {
        name: normalizedName,
        arguments: typeof finalArgs === 'string' ? finalArgs : JSON.stringify(finalArgs ?? {}),
      },
    }

    logForDebugging(
      `[ToolCallExtractor] 生成工具调用: name=${normalizedName}, args=${toolCall.function.arguments}`,
      { level: 'debug' },
    )

    return toolCall
  }

  private inferToolNameFromArgs(args: unknown): string | null {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null
    const record = args as Record<string, unknown>

    if (typeof record.tool === 'string') return record.tool
    if (typeof record.name === 'string') return record.name
    if (typeof record.function === 'string') return record.function

    if (record.command !== undefined || record.cmd !== undefined) return 'Bash'
    if (record.code !== undefined) return 'CodeInterpreter'
    if (record.queries !== undefined || record.query !== undefined) return 'WebSearch'
    if (record.url !== undefined || record.urls !== undefined) return 'WebExtractor'
    if (record.file_path !== undefined || record.filePath !== undefined) return 'Read'

    if (record.pattern !== undefined) {
      if (record.path === undefined || record.path === '' || record.recursive === true) return 'Glob'
      return 'Grep'
    }

    if (record.directory !== undefined || record.dir !== undefined) return 'ListFiles'

    if ((record.old_string !== undefined || record.new_string !== undefined) && record.path) {
      return 'StrReplaceEditor'
    }

    return null
  }

  private normalizeToolCall(parsed: unknown): ToolCall | null {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>

    const extractArgs = (excludeKey: string): unknown => {
      const argsField = record.arguments ?? record.parameters ?? record.params
      if (argsField !== undefined) return argsField

      const rest = { ...record }
      delete rest[excludeKey]
      return rest
    }

    if (typeof record.name === 'string') return this.makeToolCall(record.name, extractArgs('name'))
    if (typeof record.tool === 'string') return this.makeToolCall(record.tool, extractArgs('tool'))
    if (typeof record.function === 'string') {
      return this.makeToolCall(record.function, extractArgs('function'))
    }

    const inferred = this.inferToolNameFromArgs(record)
    return inferred ? this.makeToolCall(inferred, record) : null
  }

  private readBalancedJson(text: string, start: number): { json: string; end: number } | null {
    let index = start
    while (index < text.length && /\s/.test(text[index])) index++
    if (index >= text.length || (text[index] !== '{' && text[index] !== '[')) return null

    const stack: string[] = []
    let inString = false
    let escaped = false

    for (let position = index; position < text.length; position++) {
      const char = text[position]

      if (inString) {
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === '"') inString = false
        continue
      }

      if (char === '"') {
        inString = true
        continue
      }

      if (char === '{') stack.push('}')
      else if (char === '[') stack.push(']')
      else if (char === '}' || char === ']') {
        if (stack.pop() !== char) return null
        if (stack.length === 0) {
          return { json: text.slice(index, position + 1), end: position + 1 }
        }
      }
    }

    return null
  }

  private parseXmlArguments(raw: string): unknown {
    const trimmed = raw.trim()
    if (!trimmed) return {}

    try {
      return JSON.parse(trimmed)
    } catch {
      const jsonStart = trimmed.search(/[\[{]/)
      if (jsonStart >= 0) {
        const balanced = this.readBalancedJson(trimmed, jsonStart)
        if (balanced) {
          try {
            return JSON.parse(balanced.json)
          } catch {
            // 继续尝试 XML 参数。
          }
        }
      }

      const args: Record<string, unknown> = {}
      const parameterPattern = /<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/g
      let match: RegExpExecArray | null

      while ((match = parameterPattern.exec(trimmed)) !== null) {
        const key = match[1]
        const value = match[2].trim()
        if (value === 'true') args[key] = true
        else if (value === 'false') args[key] = false
        else if (value !== '' && !Number.isNaN(Number(value))) args[key] = Number(value)
        else args[key] = value
      }

      return Object.keys(args).length > 0 ? args : { raw: trimmed }
    }
  }

  private findStructuredJsonObject(): { start: number; end: number; toolCall: ToolCall } | null {
    for (let index = 0; index < this.buffer.length; index++) {
      if (this.buffer[index] !== '{') continue
      const balanced = this.readBalancedJson(this.buffer, index)
      if (!balanced) continue

      try {
        const parsed = JSON.parse(balanced.json)
        const toolCall = this.normalizeToolCall(parsed)
        if (toolCall) return { start: index, end: balanced.end, toolCall }
      } catch {
        // 不是可识别的结构化工具调用，继续扫描。
      }
    }

    return null
  }

  private findToolCall(): { start: number; end: number; toolCall: ToolCall } | null {
    const text = this.buffer

    // <tool_calling><name>...</name><arguments>...</arguments></tool_calling>
    const toolCalling = /<tool_calling>([\s\S]*?)<\/tool_calling>/i.exec(text)
    if (toolCalling) {
      const inner = toolCalling[1]
      const nameMatch = /<name>([\s\S]*?)<\/name>/i.exec(inner)
      const argsMatch = /<arguments>([\s\S]*?)<\/arguments>/i.exec(inner)
      if (nameMatch) {
        return {
          start: toolCalling.index,
          end: toolCalling.index + toolCalling[0].length,
          toolCall: this.makeToolCall(nameMatch[1].trim(), this.parseXmlArguments(argsMatch?.[1] ?? '{}')),
        }
      }

      const nested = /<tool_call\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/i.exec(
        inner,
      )
      if (nested) {
        return {
          start: toolCalling.index,
          end: toolCalling.index + toolCalling[0].length,
          toolCall: this.makeToolCall(nested[1], this.parseXmlArguments(nested[2])),
        }
      }
    }

    // <tool_call name="ToolName">...</tool_call>
    const toolCallAttribute = /<tool_call\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/i.exec(
      text,
    )
    if (toolCallAttribute) {
      return {
        start: toolCallAttribute.index,
        end: toolCallAttribute.index + toolCallAttribute[0].length,
        toolCall: this.makeToolCall(
          toolCallAttribute[1],
          this.parseXmlArguments(toolCallAttribute[2]),
        ),
      }
    }

    // <tool_call><name>...</name><arguments>...</arguments></tool_call>
    const nestedToolCall = /<tool_call>\s*<name>([\s\S]*?)<\/name>\s*<arguments>([\s\S]*?)<\/arguments>\s*<\/tool_call>/i.exec(
      text,
    )
    if (nestedToolCall) {
      return {
        start: nestedToolCall.index,
        end: nestedToolCall.index + nestedToolCall[0].length,
        toolCall: this.makeToolCall(
          nestedToolCall[1].trim(),
          this.parseXmlArguments(nestedToolCall[2]),
        ),
      }
    }

    // <tool_call>{...}</tool_call>
    const plainToolCall = /<tool_call>([\s\S]*?)<\/tool_call>/i.exec(text)
    if (plainToolCall) {
      try {
        const toolCall = this.normalizeToolCall(JSON.parse(plainToolCall[1].trim()))
        if (toolCall) {
          return {
            start: plainToolCall.index,
            end: plainToolCall.index + plainToolCall[0].length,
            toolCall,
          }
        }
      } catch {
        // 继续匹配其他格式。
      }
    }

    // <tool>{...}</tool>
    const toolTag = /<tool>([\s\S]*?)<\/tool>/i.exec(text)
    if (toolTag) {
      try {
        const toolCall = this.normalizeToolCall(JSON.parse(toolTag[1].trim()))
        if (toolCall) {
          return { start: toolTag.index, end: toolTag.index + toolTag[0].length, toolCall }
        }
      } catch {
        // 继续匹配其他格式。
      }
    }

    // <function_calls><function_call name="..."><parameter name="...">...</parameter></function_call></function_calls>
    const functionCalls = /<function_calls>([\s\S]*?)<\/function_calls>/i.exec(text)
    if (functionCalls) {
      const functionCall = /<function_call\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/function_call>/i.exec(
        functionCalls[1],
      )
      if (functionCall) {
        const args: Record<string, unknown> = {}
        const parameterPattern = /<parameter\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi
        let parameterMatch: RegExpExecArray | null
        while ((parameterMatch = parameterPattern.exec(functionCall[2])) !== null) {
          args[parameterMatch[1]] = parameterMatch[2].trim()
        }

        return {
          start: functionCalls.index,
          end: functionCalls.index + functionCalls[0].length,
          toolCall: this.makeToolCall(functionCall[1], args),
        }
      }
    }

    // <bash>...</bash>
    const bashXml = /<bash>\s*([\s\S]*?)\s*<\/bash>/i.exec(text)
    if (bashXml) {
      const commandMatch = /<command>([\s\S]*?)<\/command>/i.exec(bashXml[1])
      const command = (commandMatch?.[1] ?? bashXml[1]).trim()
      if (command) {
        return {
          start: bashXml.index,
          end: bashXml.index + bashXml[0].length,
          toolCall: this.makeToolCall('Bash', { command }),
        }
      }
    }

    // Tool: Name\nArguments: {...}
    const toolPrefix = /(?:^|\r?\n)\s*Tool:\s*([a-zA-Z0-9_:.-]+)\s*\r?\n\s*Arguments:\s*/i.exec(text)
    if (toolPrefix) {
      const balanced = this.readBalancedJson(text, toolPrefix.index + toolPrefix[0].length)
      if (balanced) {
        try {
          return {
            start: toolPrefix.index,
            end: balanced.end,
            toolCall: this.makeToolCall(toolPrefix[1], JSON.parse(balanced.json)),
          }
        } catch {
          // JSON 不合法时继续等待后续文本或 flush。
        }
      }
    }

    // Action: Name\nAction Input: {...}
    const actionPrefix = /(?:^|\r?\n)\s*Action:\s*([a-zA-Z0-9_:.-]+)\s*\r?\n\s*Action Input:\s*/i.exec(
      text,
    )
    if (actionPrefix) {
      const balanced = this.readBalancedJson(text, actionPrefix.index + actionPrefix[0].length)
      if (balanced) {
        try {
          return {
            start: actionPrefix.index,
            end: balanced.end,
            toolCall: this.makeToolCall(actionPrefix[1], JSON.parse(balanced.json)),
          }
        } catch {
          // JSON 不合法时继续等待后续文本或 flush。
        }
      }
    }

    // Calling: Name {...}
    const calling = /(?:^|[\s●❯\-*])Calling:\s*([a-zA-Z0-9_:.-]+)\s+/i.exec(text)
    if (calling) {
      const balanced = this.readBalancedJson(text, calling.index + calling[0].length)
      if (balanced) {
        try {
          return {
            start: calling.index,
            end: balanced.end,
            toolCall: this.makeToolCall(calling[1], JSON.parse(balanced.json)),
          }
        } catch {
          // 继续匹配其他格式。
        }
      }
    }

    // [调用 ToolName] {...}
    const chinese = /\[调用\s+([^\]]+)\]\s*/.exec(text)
    if (chinese) {
      const balanced = this.readBalancedJson(text, chinese.index + chinese[0].length)
      if (balanced) {
        try {
          return {
            start: chinese.index,
            end: balanced.end,
            toolCall: this.makeToolCall(chinese[1].trim(), JSON.parse(balanced.json)),
          }
        } catch {
          // 继续匹配其他格式。
        }
      }
    }

    // Glob({...})、Bash({...}) 等函数形式。
    const functionStyle = /\b(Glob|Bash|Read|Grep|Write|Edit|ListFiles|CodeInterpreter|WebExtractor|WebSearch|StrReplaceEditor)\s*\(/i.exec(
      text,
    )
    if (functionStyle) {
      const balanced = this.readBalancedJson(text, functionStyle.index + functionStyle[0].length)
      if (balanced) {
        const after = text.slice(balanced.end)
        const close = /^\s*\)/.exec(after)
        if (close) {
          try {
            return {
              start: functionStyle.index,
              end: balanced.end + close[0].length,
              toolCall: this.makeToolCall(functionStyle[1], JSON.parse(balanced.json)),
            }
          } catch {
            // 继续匹配其他格式。
          }
        }
      }
    }

    // ToolName: {...}
    const colonJson = /(?:^|\r?\n)\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*/m.exec(text)
    if (colonJson) {
      const jsonStart = colonJson.index + colonJson[0].length
      const balanced = this.readBalancedJson(text, jsonStart)
      if (balanced) {
        try {
          return {
            start: colonJson.index,
            end: balanced.end,
            toolCall: this.makeToolCall(colonJson[1], JSON.parse(balanced.json)),
          }
        } catch {
          // 继续匹配其他格式。
        }
      }
    }

    // ```json {...} ```
    const jsonCodeBlock = /```(?:json)?\s*\r?\n\s*([\[{][\s\S]*?[\]}])\s*\r?\n```/i.exec(text)
    if (jsonCodeBlock) {
      try {
        const parsed = JSON.parse(jsonCodeBlock[1].trim())
        const candidate = Array.isArray(parsed) ? parsed[0] : parsed
        const toolCall = this.normalizeToolCall(candidate)
        if (toolCall) {
          return {
            start: jsonCodeBlock.index,
            end: jsonCodeBlock.index + jsonCodeBlock[0].length,
            toolCall,
          }
        }
      } catch {
        // 继续匹配其他格式。
      }
    }

    // 可选：将 bash/cmd 代码块解释为真实工具调用。
    if (this.opts.enableBashCodeBlock) {
      const bashCodeBlock = /```(?:bash|batch|shell|sh|cmd|powershell|ps1)\s*\r?\n([\s\S]*?)\r?\n```/i.exec(
        text,
      )
      if (bashCodeBlock) {
        const command = bashCodeBlock[1].trim()
        if (command) {
          return {
            start: bashCodeBlock.index,
            end: bashCodeBlock.index + bashCodeBlock[0].length,
            toolCall: this.makeToolCall('Bash', { command }),
          }
        }
      }
    }

    // 结构化 JSON 对象，根据 name/tool/function 或典型参数推断工具名。
    const structuredJson = this.findStructuredJsonObject()
    if (structuredJson) return structuredJson

    // 可选：裸命令行。默认禁用。
    if (this.opts.enableBareCommandLine) {
      const bareCommand = /(?:^|\r?\n)\s*(?:findstr|cd|dir|git|grep|ls|pwd|echo|cat|head|tail|wc|sort|uniq|awk|sed|tar|zip|unzip|chmod|chown|ps|kill|rm|cp|mv|mkdir|rmdir|touch|which|where|type)\s+[^\r\n]*/im.exec(
        text,
      )
      if (bareCommand) {
        const command = bareCommand[0].trim()
        return {
          start: bareCommand.index,
          end: bareCommand.index + bareCommand[0].length,
          toolCall: this.makeToolCall('Bash', { command }),
        }
      }
    }

    return null
  }

  /**
   * 找出尚不能安全输出的尾部起点。
   * 只保留可能跨 chunk 补全为工具调用的尾部，不会全局截断普通 Tool:/Action: 文本。
   */
  private findPendingPrefixStart(): number {
    const unread = this.buffer.slice(this.emittedTextLen)
    if (!unread) return this.buffer.length

    const candidates: number[] = []
    const lowerUnread = unread.toLowerCase()

    const xmlMarkers: Array<{ open: string; close: string }> = [
      { open: '<tool_calling', close: '</tool_calling>' },
      { open: '<tool_call', close: '</tool_call>' },
      { open: '<function_calls', close: '</function_calls>' },
      { open: '<bash>', close: '</bash>' },
    ]

    for (const marker of xmlMarkers) {
      const index = lowerUnread.lastIndexOf(marker.open)
      if (index >= 0 && lowerUnread.indexOf(marker.close, index) === -1) {
        candidates.push(this.emittedTextLen + index)
      }
    }

    const protocolTail = /(?:^|\r?\n)\s*(?:Tool:\s*[A-Za-z0-9_:.-]*\s*(?:\r?\n\s*(?:Arguments:\s*)?(?:[\[{][\s\S]*)?)?|Action:\s*[A-Za-z0-9_:.-]*\s*(?:\r?\n\s*(?:Action Input:\s*)?(?:[\[{][\s\S]*)?)?|Calling:\s*[A-Za-z0-9_:.-]*\s*(?:[\[{][\s\S]*)?|\[调用\s+[^\]]*\]?\s*(?:[\[{][\s\S]*)?)$/i.exec(
      unread,
    )

    if (protocolTail) {
      candidates.push(this.emittedTextLen + protocolTail.index)
    }

    // 跨 chunk 的短前缀，例如 "<tool_ca"、"Act"。
    const prefixes = [
      '<tool_calling',
      '<tool_call',
      '<function_calls',
      '<bash>',
      'Tool:',
      'Action:',
      'Calling:',
      '[调用',
    ]
    const maxPrefixLength = Math.max(...prefixes.map(prefix => prefix.length))

    for (
      let index = Math.max(0, unread.length - maxPrefixLength + 1);
      index < unread.length;
      index++
    ) {
      const suffix = unread.slice(index).toLowerCase()
      if (prefixes.some(prefix => prefix.toLowerCase().startsWith(suffix))) {
        candidates.push(this.emittedTextLen + index)
        break
      }
    }

    return candidates.length > 0 ? Math.min(...candidates) : this.buffer.length
  }

  extract(delta: string): ExtractResult {
    // 已输出文本不再参与后续扫描，避免重复解释或重复输出。
    if (this.emittedTextLen > 0) {
      this.buffer = this.buffer.slice(this.emittedTextLen)
      this.emittedTextLen = 0
    }

    this.buffer += delta
    const toolCalls: ToolCall[] = []

    while (true) {
      const match = this.findToolCall()
      if (!match) break

      toolCalls.push(...this.addIfNew(match.toolCall))
      this.buffer = this.buffer.slice(0, match.start) + this.buffer.slice(match.end)
    }

    const safeEnd = this.findPendingPrefixStart()
    const text = this.buffer.slice(0, safeEnd)
    this.emittedTextLen = safeEnd

    return {
      text,
      toolCalls,
      remaining: this.buffer.slice(safeEnd),
    }
  }

  /**
   * 流结束时释放所有安全文本。
   * 不再丢弃不完整工具前缀；否则 UI 会表现为回答尾部消失。
   */
  flush(): ExtractResult {
    const finalResult = this.extract('')
    const remainingText = this.buffer.slice(this.emittedTextLen)
    this.reset()

    return {
      text: finalResult.text + remainingText,
      toolCalls: finalResult.toolCalls,
      remaining: '',
    }
  }

  reset(): void {
    this.buffer = ''
    this.emittedTextLen = 0
    this.toolCallCounter = 0
    this.emittedToolKeys.clear()
  }
}