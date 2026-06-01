import { APIError } from '@anthropic-ai/sdk'
// 引入调试日志工具（实际写入文件或控制台，取决于项目配置）
import { logForDebugging } from "../../utils/debug.js"

import type {
  BetaMessage,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { AssistantMessage } from 'src/types/message.js'

type AnyBlock = Record<string, unknown>

// OpenAI 兼容配置
type OpenAICompatConfig = {
  apiKey: string
  baseURL: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}

// OpenAI 工具调用结构
type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

// OpenAI 对话消息
type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
}
// 添加在文件开头
function isWSL(): boolean {
		try {
				const version = require('fs').readFileSync('/proc/version', 'utf8');
				return version.toLowerCase().includes('microsoft');
		} catch {
				return false;
		}
}

function mapCommandForPlatform(cmd: string): string {
		if (!isWSL() && process.platform !== 'linux') return cmd;

		const mappings: Record<string, string> = {
				'move': 'mv',
				'copy': 'cp',
				'del': 'rm',
				'rename': 'mv',
				'type': 'cat',
				'dir': 'ls -la'
		};

		for (const [winCmd, linuxCmd] of Object.entries(mappings)) {
				if (cmd.trim().startsWith(winCmd)) {
						return cmd.replace(winCmd, linuxCmd);
				}
		}
		return cmd;
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
type OpenAIStreamChunk = {
  id?: string
  model?: string
  choices?: Array<{
    index?: number
    delta?: {
      role?: 'assistant'
      content?: string | null
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

/**
 * 将 Anthropic 的消息内容（可能是字符串或内容块数组）转换为纯文本
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

  // 处理 system prompt（可能是字符串或内容块数组）
  if (input.system) {
    const systemText = Array.isArray(input.system)
      ? input.system.map(block => block.text ?? '').join('\n')
      : input.system
    if (systemText) {
      messages.push({ role: 'system', content: systemText })
      logForDebugging(`[openaiCompat] 添加 system 消息 (长度: ${systemText.length})`, { level: 'debug' })
    }
  }

  // 逐条转换消息
  for (const message of input.messages) {
    logForDebugging(`[openaiCompat] 处理消息 role=${message.role}`, { level: 'debug' })
    if (message.role === 'user') {
      const blocks = toBlocks(message.content)
      // 提取 tool_result 块，转换为 OpenAI 的 tool 消息
      const toolResults = blocks.filter(block => block.type === 'tool_result')
      for (const result of toolResults) {
        const toolUseId =
          typeof result.tool_use_id === 'string' ? result.tool_use_id : undefined
        const content = result.content
        messages.push({
          role: 'tool',
          tool_call_id: toolUseId,
          content: typeof content === 'string' ? content : JSON.stringify(content),
        })
        logForDebugging(`[openaiCompat] 添加 tool 消息 (tool_use_id=${toolUseId}, content长度=${typeof content === 'string' ? content.length : 'object'})`, { level: 'debug' })
      }
      // 将剩余的非工具结果内容拼接为用户消息
      const text = contentToText(
        blocks.filter(block => block.type !== 'tool_result') as unknown as BetaMessageParam['content'],
      )
      if (text) {
        messages.push({ role: 'user', content: text })
        logForDebugging(`[openaiCompat] 添加 user 消息 (长度: ${text.length})`, { level: 'debug' })
      }
      continue
    }

    if (message.role === 'assistant') {
      const blocks = Array.isArray(message.content)
        ? (message.content as unknown as AnyBlock[])
        : []
      const text = blocks
        .filter(block => block.type === 'text')
        .map(block => (typeof block.text === 'string' ? block.text : ''))
        .join('')

      const toolCalls = blocks
        .filter(block => block.type === 'tool_use')
        .map(block => ({
          id: String(block.id),
          type: 'function' as const,
          function: {
            name: String(block.name),
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
      logForDebugging(`[openaiCompat] 添加 assistant 消息 (text长度=${text.length}, toolCalls数量=${toolCalls.length})`, { level: 'debug' })
    }
  }

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
 * 向 OpenAI 兼容端点发起流式 POST 请求，返回可读流读取器
 * 内置了错误处理，对 429/529/5xx 抛出 APIError，以便上游进行重试
 */
export async function createOpenAICompatStream(
  config: { apiKey: string; baseURL: string; headers?: Record<string, string>; fetch?: typeof fetch },
  request: any,
  signal: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const baseURL = config.baseURL.replace(/\/+$/, '')
  const url = `${baseURL}/v1/chat/completions`
  logForDebugging('[openaiCompat] 准备请求 URL: ' + url, { level: 'debug' })
  logForDebugging(`[openaiCompat] 请求体: ${JSON.stringify({ ...request, stream: true })}`, { level: 'debug' })
  const response = await (config.fetch ?? globalThis.fetch)(
    url,
    {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        ...config.headers,
      },
      body: JSON.stringify({ ...request, stream: true }),
    },
  );

  if (!response.ok || !response.body) {
    let responseText = ''
    try {
      responseText = await response.text()
    } catch {
      responseText = ''
    }
    logForDebugging(`[openaiCompat] 响应错误: status=${response.status}, body=${responseText}`, { level: 'debug' })

    // 对可重试的状态码（429/529/5xx）抛出 APIError，以便 withRetry 能识别并进行指数退避重试
    if (response.status === 429 || response.status === 529 || response.status >= 500) {
      let errorBody: object | undefined
      try {
        errorBody = JSON.parse(responseText)
      } catch {
        errorBody = { message: responseText }
      }
      const respHeaders = new Headers(response.headers as HeadersInit)
      throw new APIError(
        response.status,
        errorBody,
        'OpenAI compat request failed with status ' + response.status + (responseText ? ': ' + responseText : ''),
        respHeaders,
      )
    }

    throw new Error(
      `OpenAI compat request failed with status ${response.status}${responseText ? ': ' + responseText : ''}. 请确认服务端返回的是有效的 OpenAI 格式响应。`,
    )
  }

  logForDebugging(`[openaiCompat] 请求成功, 状态码=${response.status}, 准备读取流`, { level: 'debug' })
  return response.body.getReader()
}

/**
 * 解析 SSE 流缓冲区，返回完整的事件数组和未完成的部分
 * 按双换行分隔，最后一个不完整的块存入 remainder
 */
function parseSSEChunk(buffer: string): { events: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  return { events: parts, remainder }
}

/**
 * 将 OpenAI 的 finish_reason 映射为 Anthropic 的 stop_reason
 */
function mapFinishReason(reason: string | null | undefined): BetaMessage['stop_reason'] {
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}
/**
 * 将 OpenAI 兼容的流式响应转换为 Anthropic 的 Stream 事件（BetaRawMessageStreamEvent）
 * 该异步生成器会不断 yield 事件，直到流结束并返回最终的 BetaMessage
 *
 * 处理逻辑：
 * 1. 如果 chunk 中包含 choices 字段，则按 OpenAI 格式解析 delta
 * 2. 如果没有 choices，视为原生 Anthropic 事件路径（已包含完整的 BetaRawMessageStreamEvent 字段）
 * 3. 自动合成缺失的 content_block_start / content_block_stop / message_delta
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

  // OpenAI 格式：{ id, choices: [{ message, finish_reason }], usage }
  if (Array.isArray(parsed.choices) || (parsed.object === 'chat.completion')) {
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined
    const choice = choices?.[0]
    const message = choice?.message as Record<string, unknown> | undefined
    const finishReason = choice?.finish_reason as string | null | undefined
    const usage = parsed.usage as Record<string, unknown> | undefined
    const promptTokens = (usage?.prompt_tokens as number) ?? 0
    const completionTokens = (usage?.completion_tokens as number) ?? 0
    const events: BetaRawMessageStreamEvent[] = []
    let nextIdx = 0

    events.push({
      type: 'message_start',
      message: {
        id: (parsed.id as string) ?? 'openai-compat',
        type: 'message',
        role: 'assistant', model,
        content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: promptTokens, output_tokens: 0 },
      } as any,
    })

    const content = message?.content as string | undefined
    const toolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined

    if (content && content.length > 0) {
      const textIdx = nextIdx++
      events.push({ type: 'content_block_start', index: textIdx, content_block: { type: 'text', text: '' } } as any)
      events.push({ type: 'content_block_delta', index: textIdx, delta: { type: 'text_delta', text: content } } as any)
      events.push({ type: 'content_block_stop', index: textIdx } as any)
    }

    if (toolCalls) {
      for (const tc of toolCalls) {
        const idx = nextIdx++
        const fn = tc.function as Record<string, unknown> | undefined
        const rawInput = (fn?.arguments as string) ?? '{}'
        events.push({
          type: 'content_block_start', index: idx,
          content_block: { type: 'tool_use', id: (tc.id as string) ?? `toolu_${idx}`, name: (fn?.name as string) ?? '', input: '' },
        } as any)
        events.push({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: rawInput } } as any)
        events.push({ type: 'content_block_stop', index: idx } as any)
      }
    }

    events.push({
      type: 'message_delta',
      delta: { stop_reason: mapFinishReason(finishReason ?? 'stop'), stop_sequence: null },
      usage: { output_tokens: completionTokens },
    } as any)

    return {
      promptTokens, completionTokens, events,
      resultMessage: {
        id: (parsed.id as string) ?? 'openai-compat', type: 'message', role: 'assistant', model,
        content: [] as any,
        stop_reason: mapFinishReason(finishReason ?? 'stop'), stop_sequence: null,
        usage: { input_tokens: promptTokens, output_tokens: completionTokens },
      } as BetaMessage,
    }
  }

  // Anthropic 原生格式：{ type: 'message', content: [...] }
  if ((parsed.type as string) === 'message' && Array.isArray(parsed.content)) {
    const blocks = parsed.content as Array<Record<string, unknown>>
    const usage = parsed.usage as Record<string, unknown> | undefined
    const stopReason = parsed.stop_reason as string | null | undefined
    const promptTokens = (usage?.input_tokens as number) ?? 0
    const completionTokens = (usage?.output_tokens as number) ?? 0
    const events: BetaRawMessageStreamEvent[] = []
    let idx = 0

    events.push({
      type: 'message_start',
      message: {
        id: (parsed.id as string) ?? 'anthropic-native', type: 'message', role: 'assistant', model,
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: promptTokens, output_tokens: 0 },
      } as any,
    })

    for (const block of blocks) {
      const bt = block.type as string
      if (bt === 'text') {
        events.push({ type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } } as any)
        events.push({ type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: block.text as string } } as any)
        events.push({ type: 'content_block_stop', index: idx } as any)
      } else if (bt === 'tool_use') {
        const inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {})
        events.push({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: block.id as string, name: block.name as string, input: '' } } as any)
        events.push({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: inputStr } } as any)
        events.push({ type: 'content_block_stop', index: idx } as any)
      } else if (bt === 'thinking') {
        events.push({ type: 'content_block_start', index: idx, content_block: { type: 'thinking', thinking: '', signature: '' } } as any)
        events.push({ type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking: block.thinking as string } } as any)
        if (block.signature) {
          events.push({ type: 'content_block_delta', index: idx, delta: { type: 'signature_delta', signature: block.signature as string } } as any)
        }
        events.push({ type: 'content_block_stop', index: idx } as any)
      }
      idx++
    }

    events.push({
      type: 'message_delta',
      delta: { stop_reason: stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: completionTokens },
    } as any)

    return { promptTokens, completionTokens, events, resultMessage: parsed as unknown as BetaMessage }
  }

  return null
}

export async function* createAnthropicStreamFromOpenAI(input: {
  reader: ReadableStreamDefaultReader<Uint8Array>
  model: string
}): AsyncGenerator<BetaRawMessageStreamEvent, BetaMessage, void> {
  const decoder = new TextDecoder()
  let buffer = ''
  let started = false
  let nextContentIndex = 0
  let promptTokens = 0
  let completionTokens = 0
  let responseBytes = 0
 
  const toolExtractor = new ToolCallExtractor({ enableBashCodeBlock: true }) 
  const collectedToolCalls: ToolCall[] = []
  let collectedText = ''  
 
  const nativeIdxMap = new Map<number, number>()
  const nativeBlockType = new Map<number, 'text' | 'tool_use'>()
  const nativeToolUseInfo = new Map<number, { id: string; name: string }>()
  let nativeMessageDeltaSent = false
 
  let activeBlockType: 'text' | null = null
  let activeBlockIndex: number | null = null
  const toolIdxMap = new Map<number, number>()
  const toolState = new Map<number, { id: string; name: string; arguments: string }>()

  logForDebugging(`[openaiCompat] 开始将 OpenAI 流转换为 Anthropic 事件, model=${input.model}`, { level: 'debug' })

  async function* closeActiveBlock() {
    if (activeBlockType && activeBlockIndex !== null) {
      yield { type: 'content_block_stop', index: activeBlockIndex } as BetaRawMessageStreamEvent
      activeBlockType = null
      activeBlockIndex = null
    }
  }

  async function* closeAllNativeBlocks() {
    for (const [idx] of nativeBlockType) {
      logForDebugging(`[openaiCompat] 关闭原生块 index=${idx}`, { level: 'debug' })
      yield { type: 'content_block_stop', index: idx } as BetaRawMessageStreamEvent
    }
    nativeBlockType.clear()
    nativeIdxMap.clear()
  }
 
  function createAssistantMessageFromToolCalls(): AssistantMessage | null {
    if (collectedToolCalls.length === 0) return null;
    logForDebugging(`[openaiCompat] 产出 AssistantMessage，包含 ${collectedToolCalls.length} 个工具调用`, { level: 'debug' });
    return {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: collectedToolCalls.map(tc => ({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        })),
        usage: { input_tokens: promptTokens, output_tokens: completionTokens },
      },
      uuid: crypto.randomUUID(),
      parentUuid: undefined,
      source: 'api',
    } as AssistantMessage;
  }
  logForDebugging('[openaiCompat] 开始将 OpenAI 流转换为 Anthropic 事件', { level: 'debug' })

  while (true) {
    const { done, value } = await input.reader.read()
    if (done) {
      logForDebugging(`[openaiCompat] 流读取完成, 总响应字节数=${responseBytes}`, { level: 'debug' })
      break
    }
    if (value?.byteLength) responseBytes += value.byteLength
    buffer += decoder.decode(value, { stream: true })
    const sse = parseSSEChunk(buffer)
    buffer = sse.remainder

    for (const rawEvent of sse.events) {
      const dataLines = rawEvent
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())

      for (const data of dataLines) {
        if (!data || data === '[DONE]') {
          if (data === '[DONE]') {
            logForDebugging('[openaiCompat] 收到 [DONE] 事件，开始收尾', { level: 'debug' })
            // 提取剩余的缓冲区内容
            const flushResult = toolExtractor.flush()
            if (flushResult.text) {
              collectedText += flushResult.text
              if (activeBlockType !== 'text') {
                yield* closeActiveBlock()
                activeBlockIndex = nextContentIndex++
                yield { type: 'content_block_start', index: activeBlockIndex, content_block: { type: 'text', text: '' } }
                activeBlockType = 'text'
              }
              yield { type: 'content_block_delta', index: activeBlockIndex, delta: { type: 'text_delta', text: flushResult.text } }
            }
            for (const tc of flushResult.toolCalls) {
              collectedToolCalls.push(tc)  // 收集工具调用
              yield* closeActiveBlock()
              const idx = nextContentIndex++
              let input: any
              try { input = JSON.parse(tc.function.arguments) } catch { input = {} }
              yield { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: '' } }
              yield { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } }
              yield { type: 'content_block_stop', index: idx }
            }
            // 关闭原有工具块
            await closeActiveBlock()
            for (const ai of toolIdxMap.values()) {
              logForDebugging(`[openaiCompat] 关闭工具块 index=${ai}`, { level: 'debug' })
              yield { type: 'content_block_stop', index: ai } as BetaRawMessageStreamEvent
            }
            if (!nativeMessageDeltaSent && started) {
              logForDebugging('[openaiCompat] 发送 message_delta (end_turn)', { level: 'debug' })
              yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: completionTokens } } as BetaRawMessageStreamEvent
            }
            // 不再产出自定义 assistant 事件
            yield { type: 'message_stop' } as BetaRawMessageStreamEvent
            _lastResponseBytes = responseBytes
            logForDebugging(`[openaiCompat] 流结束, 最终 token 用量: input=${promptTokens}, output=${completionTokens}, 字节=${responseBytes}`, { level: 'debug' })

            // ========== 关键修复：构建包含工具调用的 content ==========
            const finalContent: any[] = []
            if (collectedText) {
              finalContent.push({ type: 'text', text: collectedText })
            }
            for (const tc of collectedToolCalls) {
              let inputObj: any
              try { inputObj = JSON.parse(tc.function.arguments) } catch { inputObj = {} }
              finalContent.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: inputObj,
              })
            }
						for (const block of finalContent) {
								if (block.type === 'tool_use') {
										const idx = nextContentIndex++;
										yield { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: block.id, name: block.name, input: '' } } as any;
										const inputStr = JSON.stringify(block.input);
										yield { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: inputStr } } as any;
										yield { type: 'content_block_stop', index: idx } as any;
								} else if (block.type === 'text') {
										// 如果还有文本块，也可以输出，但通常工具调用时文本已经处理过
								}
						}
						
						 // ========== 关键添加：将工具调用作为 AssistantMessage 发送 ==========
						const toolUseBlocks = finalContent.filter(block => block.type === 'tool_use');
						if (toolUseBlocks.length > 0) {
								const assistantMsg = {
										type: 'assistant',
										message: {
												role: 'assistant',
												content: toolUseBlocks,
												usage: { input_tokens: promptTokens, output_tokens: completionTokens }
										},
										uuid: crypto.randomUUID(),
										parentUuid: undefined,
										source: 'api'
								};
								yield assistantMsg as any;
						}
            const finalMessage: BetaMessage = {
              id: 'openai-compat',
              type: 'message',
              role: 'assistant',
              model: input.model,
              content: finalContent,
              stop_reason: 'tool_use',
              stop_sequence: null,
              usage: { input_tokens: promptTokens, output_tokens: completionTokens }
            } as BetaMessage
            return finalMessage
          }
          continue
        }

        let event: Record<string, unknown>
        try {
          event = JSON.parse(data) as Record<string, unknown>
        } catch (e) {
          logForDebugging(`[openaiCompat] 无法解析事件数据: ${data.slice(0, 200)}`, { level: 'debug' })
          continue
        }
        if (!event || typeof event !== 'object') continue
        logForDebugging(`[openaiCompat] 收到事件: ${JSON.stringify(event).slice(0, 500)}`, { level: 'debug' })

        const hasChoices = Array.isArray(event.choices) && event.choices.length > 0

        // ===============================
        // 原生 Anthropic 事件路径（无 choices 字段）
        // ===============================
        if (!hasChoices) {
          const evType = event.type as string
          if (!evType) continue
          switch (evType) {
            case 'message_start': {
              started = true
              const msg = event.message as Record<string, unknown>
              if (msg && !msg.model) msg.model = input.model
              const u = event.usage as Record<string, unknown>
              if (u?.input_tokens) promptTokens = u.input_tokens as number
              yield { type: 'message_start', message: msg ?? { id: 'anthropic-native', type: 'message', role: 'assistant', model: input.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }
              break
            }
            case 'content_block_start': {
              const upstreamIdx = Number(event.index) || 0
              let anthropicIdx = nativeIdxMap.get(upstreamIdx)
              if (anthropicIdx === undefined) {
                anthropicIdx = nextContentIndex++
                nativeIdxMap.set(upstreamIdx, anthropicIdx)
              }
              const block = event.content_block as Record<string, unknown>
              if (block?.type === 'tool_use') {
                nativeBlockType.set(anthropicIdx, 'tool_use')
                nativeToolUseInfo.set(anthropicIdx, { id: (block.id as string) || '', name: (block.name as string) || '' })
                logForDebugging(`[openaiCompat] 原生 tool_use 开始: index=${anthropicIdx}, name=${block.name}, id=${block.id}`, { level: 'debug' })
                yield { type: 'content_block_start', index: anthropicIdx, content_block: block }
              } else {
                nativeBlockType.set(anthropicIdx, 'text')
                logForDebugging(`[openaiCompat] 原生文本块开始: index=${anthropicIdx}`, { level: 'debug' })
                yield { type: 'content_block_start', index: anthropicIdx, content_block: { type: 'text', text: '' } } as BetaRawMessageStreamEvent
              }
              break
            }
            case 'content_block_delta': {
              const upstreamIdx = Number(event.index) || 0
              let anthropicIdx = nativeIdxMap.get(upstreamIdx)
              const delta = event.delta as Record<string, unknown>
              const originalType = delta?.type
              if (originalType === 'signature_delta') {
                logForDebugging(`[openaiCompat] 跳过 signature_delta (index=${upstreamIdx})`, { level: 'debug' })
                continue
              }
              let outputDelta = delta
              if (originalType === 'thinking_delta') {
                outputDelta = { type: 'text_delta', text: delta.thinking }
                logForDebugging(`[openaiCompat] 转换 thinking_delta 为 text_delta, 文本长度=${String(delta.thinking).length}`, { level: 'debug' })
              }
              if (anthropicIdx === undefined) {
                anthropicIdx = nextContentIndex++
                nativeIdxMap.set(upstreamIdx, anthropicIdx)
                const guessType = originalType === 'input_json_delta' ? 'tool_use' : 'text'
                nativeBlockType.set(anthropicIdx, guessType)
                logForDebugging(`[openaiCompat] 自动合成 ${guessType} 块 (upstream ${upstreamIdx} -> Anthropic ${anthropicIdx})`, { level: 'debug' })
                if (guessType === 'tool_use') {
                  const id = (delta?.id as string) || `toolu_${anthropicIdx}`
                  const name = (delta?.name as string) || ''
                  nativeToolUseInfo.set(anthropicIdx, { id, name })
                  yield { type: 'content_block_start', index: anthropicIdx, content_block: { type: 'tool_use', id, name, input: '' } }
                } else {
                  yield { type: 'content_block_start', index: anthropicIdx, content_block: { type: 'text', text: '' } }
                }
              }
              if (nativeBlockType.get(anthropicIdx) === 'tool_use' && (delta?.id || delta?.name)) {
                const info = nativeToolUseInfo.get(anthropicIdx) ?? { id: '', name: '' }
                if (delta.id) info.id = delta.id as string
                if (delta.name) info.name = delta.name as string
                nativeToolUseInfo.set(anthropicIdx, info)
              }
              yield { type: 'content_block_delta', index: anthropicIdx, delta: outputDelta }
              break
            }
            case 'content_block_stop': {
              const upstreamIdx = Number(event.index) || 0
              const anthropicIdx = nativeIdxMap.get(upstreamIdx)
              if (anthropicIdx !== undefined) {
                nativeBlockType.delete(anthropicIdx)
                nativeIdxMap.delete(upstreamIdx)
                yield { type: 'content_block_stop', index: anthropicIdx }
              }
              break
            }
            case 'message_delta': {
              const u = event.usage as Record<string, unknown>
              if (u?.output_tokens) completionTokens = u.output_tokens as number
              nativeMessageDeltaSent = true
              yield { type: 'message_delta', delta: event.delta as any, usage: { output_tokens: completionTokens } }
              break
            }
            case 'message_stop': {
              yield* closeAllNativeBlocks()
              if (!nativeMessageDeltaSent) {
                yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: completionTokens } }
              }
              // 不再产出自定义 assistant 事件
              _lastResponseBytes = responseBytes
              yield { type: 'message_stop' }

              // ========== 关键修复：构建包含工具调用的 content ==========
              const finalContent: any[] = []
              if (collectedText) finalContent.push({ type: 'text', text: collectedText })
              for (const tc of collectedToolCalls) {
                let inputObj: any
                try { inputObj = JSON.parse(tc.function.arguments) } catch { inputObj = {} }
                finalContent.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: inputObj })
              }
							
							for (const block of finalContent) {
									if (block.type === 'tool_use') {
											const idx = nextContentIndex++;
											yield { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: block.id, name: block.name, input: '' } } as any;
											const inputStr = JSON.stringify(block.input);
											yield { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: inputStr } } as any;
											yield { type: 'content_block_stop', index: idx } as any;
									} else if (block.type === 'text') {
											// 如果还有文本块，也可以输出，但通常工具调用时文本已经处理过
									}
							}
							
							 // ========== 关键添加：将工具调用作为 AssistantMessage 发送 ==========
							const toolUseBlocks = finalContent.filter(block => block.type === 'tool_use');
							if (toolUseBlocks.length > 0) {
									const assistantMsg = {
											type: 'assistant',
											message: {
													role: 'assistant',
													content: toolUseBlocks,
													usage: { input_tokens: promptTokens, output_tokens: completionTokens }
											},
											uuid: crypto.randomUUID(),
											parentUuid: undefined,
											source: 'api'
									};
									yield assistantMsg as any;
							}
              const finalMessage: BetaMessage = {
                id: 'anthropic-native',
                type: 'message',
                role: 'assistant',
                model: input.model,
                content: finalContent,
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: promptTokens, output_tokens: completionTokens }
              } as BetaMessage
              yield { type: 'final_message', message: finalMessage } as any;
              return finalMessage
            }
          }
          continue
        }

        // ===============================
        // OpenAI choices 路径
        // ===============================
        const chunk = event as unknown as OpenAIStreamChunk
        const choice = chunk.choices[0]
        const delta = choice ? (choice.delta as Record<string, unknown>) : void 0

        if (!started) {
          started = true
          promptTokens = chunk.usage?.prompt_tokens ?? 0
          yield { type: 'message_start', message: { id: chunk.id ?? 'openai-compat', type: 'message', role: 'assistant', model: input.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: promptTokens, output_tokens: 0 } } }
        }

        // ========== 关键修改：使用 ToolCallExtractor 处理文本增量 ==========
				if (delta?.content) {
						// 先定义 text，再调用 extract
						const text = delta.content as string;
						const result = toolExtractor.extract(text);   // 唯一的 result 声明

						// 收集工具调用
						for (const tc of result.toolCalls) {
								collectedToolCalls.push(tc);
						}

						// 输出纯文本部分
						if (result.text) {
								collectedText += result.text;
								if (activeBlockType !== 'text') {
										yield* closeActiveBlock();
										activeBlockIndex = nextContentIndex++;
										yield { type: 'content_block_start', index: activeBlockIndex, content_block: { type: 'text', text: '' } };
										activeBlockType = 'text';
								}
								yield { type: 'content_block_delta', index: activeBlockIndex, delta: { type: 'text_delta', text: result.text } };
						}

						// 输出提取到的工具调用（转换为 Anthropic 事件）
						for (const toolCall of result.toolCalls) {
								yield* closeActiveBlock();
								const idx = nextContentIndex++;
								let input: any;
								try { input = JSON.parse(toolCall.function.arguments); } catch { input = {}; }
								yield { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: toolCall.id, name: toolCall.function.name, input: '' } };
								yield { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: toolCall.function.arguments } };
								yield { type: 'content_block_stop', index: idx };
						}
				}
        // 处理 thinking 增量（保持原有逻辑）
        if (delta && (delta as any).thinking !== undefined) {
          const t = (delta as any).thinking as string
          collectedText += t
          if (activeBlockType !== 'text') {
            yield* closeActiveBlock()
            activeBlockIndex = nextContentIndex++
            yield { type: 'content_block_start', index: activeBlockIndex, content_block: { type: 'text', text: '' } }
            activeBlockType = 'text'
          }
          yield { type: 'content_block_delta', index: activeBlockIndex, delta: { type: 'text_delta', text: t } }
        }

        // 处理原始的 OpenAI tool_calls（可选，保留兼容）
        if (delta && Array.isArray((delta as any).tool_calls)) {
          yield* closeActiveBlock()
          for (const tc of (delta as any).tool_calls as any[]) {
            const oi = tc.index ?? 0
            let ai = toolIdxMap.get(oi)
            if (ai === undefined) {
              ai = nextContentIndex++
              toolIdxMap.set(oi, ai)
              const state = { id: tc.id ?? `toolu_${oi}`, name: tc.function?.name ?? '', arguments: '' }
              toolState.set(oi, state)
              // 收集工具调用（注意：这里也要收集）
              collectedToolCalls.push({
                id: state.id,
                type: 'function',
                function: { name: state.name, arguments: state.arguments }
              })
              yield { type: 'content_block_start', index: ai, content_block: { type: 'tool_use', id: state.id, name: state.name, input: '' } }
            }
            const state = toolState.get(oi)
            if (state && tc.function?.arguments) {
              state.arguments += tc.function.arguments
              yield { type: 'content_block_delta', index: ai, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } }
            }
          }
        }

        // finish_reason 处理（结束消息前 flush 提取器）
				if (choice?.finish_reason) {
          logForDebugging(`[openaiCompat] 收到 finish_reason=${choice.finish_reason}, 准备结束消息`, { level: 'debug' })
          // 提取剩余缓冲区内容
          const flushResult = toolExtractor.flush()
          if (flushResult.text) {
            collectedText += flushResult.text
            if (activeBlockType !== 'text') {
              yield* closeActiveBlock()
              activeBlockIndex = nextContentIndex++
              yield { type: 'content_block_start', index: activeBlockIndex, content_block: { type: 'text', text: '' } }
              activeBlockType = 'text'
            }
            yield { type: 'content_block_delta', index: activeBlockIndex, delta: { type: 'text_delta', text: flushResult.text } }
          }
          for (const tc of flushResult.toolCalls) {
            collectedToolCalls.push(tc)
            yield* closeActiveBlock()
            const idx = nextContentIndex++
            let input: any
            try { input = JSON.parse(tc.function.arguments) } catch { input = {} }
            yield { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: '' } }
            yield { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } }
            yield { type: 'content_block_stop', index: idx }
          }

          yield* closeActiveBlock()
          for (const ai of toolIdxMap.values()) {
            yield { type: 'content_block_stop', index: ai }
          }
          completionTokens = chunk.usage?.completion_tokens ?? completionTokens
          _lastResponseBytes = responseBytes
          // 不再产出自定义 assistant 事件
          yield { type: 'message_delta', delta: { stop_reason: mapFinishReason(choice.finish_reason), stop_sequence: null }, usage: { output_tokens: completionTokens } }
          yield { type: 'message_stop' }

          // ========== 关键修复：构建包含工具调用的 content ==========
          const finalContent: any[] = []
          if (collectedText) finalContent.push({ type: 'text', text: collectedText })
          for (const tc of collectedToolCalls) {
            let inputObj: any
            try { inputObj = JSON.parse(tc.function.arguments) } catch { inputObj = {} }
            finalContent.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: inputObj })
          }
					
					 // ========== 关键添加：将工具调用作为 AssistantMessage 发送 ==========
					const toolUseBlocks = finalContent.filter(block => block.type === 'tool_use');
					if (toolUseBlocks.length > 0) {
							const assistantMsg = {
									type: 'assistant',
									message: {
											role: 'assistant',
											content: toolUseBlocks,
											usage: { input_tokens: promptTokens, output_tokens: completionTokens }
									},
									uuid: crypto.randomUUID(),
									parentUuid: undefined,
									source: 'api'
							};
							yield assistantMsg as any;
					}
					for (const block of finalContent) {
							if (block.type === 'tool_use') {
									const idx = nextContentIndex++;
									yield { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: block.id, name: block.name, input: '' } } as any;
									const inputStr = JSON.stringify(block.input);
									yield { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: inputStr } } as any;
									yield { type: 'content_block_stop', index: idx } as any;
							} else if (block.type === 'text') {
									// 如果还有文本块，也可以输出，但通常工具调用时文本已经处理过
							}
					}
          const finalMessage: BetaMessage = {
            id: chunk.id ?? 'openai-compat',
            type: 'message',
            role: 'assistant',
            model: input.model,
            content: finalContent,
            stop_reason: mapFinishReason(choice.finish_reason),
            stop_sequence: null,
            usage: { input_tokens: promptTokens, output_tokens: completionTokens }
          } as BetaMessage
          yield { type: 'final_message', message: finalMessage } as any;
          return finalMessage
        }
      }
    }
  }

  if (!started && buffer.trim()) {
    const maybeParsed = tryParseNonStreamingResponse(buffer.trim(), input.model)
    if (maybeParsed) {
      started = true
      promptTokens = maybeParsed.promptTokens
      completionTokens = maybeParsed.completionTokens
      for (const ev of maybeParsed.events) yield ev
      _lastResponseBytes = responseBytes
      yield { type: 'message_stop' }
      // 同样修复这里的返回消息 content
      const finalContent: any[] = []
      if (collectedText) finalContent.push({ type: 'text', text: collectedText })
      for (const tc of collectedToolCalls) {
        let inputObj: any
        try { inputObj = JSON.parse(tc.function.arguments) } catch { inputObj = {} }
        finalContent.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: inputObj })
      }
      const resultMsg = maybeParsed.resultMessage
      resultMsg.content = finalContent as any
      yield { type: 'final_message', message: resultMsg } as any;
      return resultMsg
    }
  }

  // 流意外结束时的清理
  logForDebugging(`[openaiCompat] 流意外结束`, { level: 'debug' })
  const flushResult = toolExtractor.flush()
  if (flushResult.text) {
    collectedText += flushResult.text
    if (activeBlockType !== 'text') {
      yield* closeActiveBlock()
      activeBlockIndex = nextContentIndex++
      yield { type: 'content_block_start', index: activeBlockIndex, content_block: { type: 'text', text: '' } }
      activeBlockType = 'text'
    }
    yield { type: 'content_block_delta', index: activeBlockIndex, delta: { type: 'text_delta', text: flushResult.text } }
  }
  for (const tc of flushResult.toolCalls) {
    collectedToolCalls.push(tc)
    yield* closeActiveBlock()
    const idx = nextContentIndex++
    let input: any
    try { input = JSON.parse(tc.function.arguments) } catch { input = {} }
    yield { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: '' } }
    yield { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } }
    yield { type: 'content_block_stop', index: idx }
  }
  yield* closeActiveBlock()
  for (const ai of toolIdxMap.values()) yield { type: 'content_block_stop', index: ai }
  yield* closeAllNativeBlocks()
  // 不再产出自定义 assistant 事件
  _lastResponseBytes = responseBytes
  if (!started) throw new Error(`[openaiCompat] 未收到 message_start 事件，模型: ${input.model}`)
  
  // 同样修复
  const finalContent: any[] = []
  if (collectedText) finalContent.push({ type: 'text', text: collectedText })
  for (const tc of collectedToolCalls) {
    let inputObj: any
    try { inputObj = JSON.parse(tc.function.arguments) } catch { inputObj = {} }
    finalContent.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: inputObj })
  }
  const fallbackMessage: BetaMessage = {
    id: 'openai-compat-fallback',
    type: 'message',
    role: 'assistant',
    model: input.model,
    content: finalContent,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: promptTokens, output_tokens: completionTokens }
  } as BetaMessage
  yield { type: 'final_message', message: fallbackMessage } as any;
  return fallbackMessage
}

// 记录最近一次 OpenAI 兼容请求的响应字节数（供外部监控使用）
let _lastResponseBytes = 0
export function getLastResponseBytes(): number {
  return _lastResponseBytes
}

/**
 * 将 OpenAI 的 usage 信息映射为 Anthropic 的 BetaUsage 结构
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

// ================== 工具调用提取器（完整修复版） ==================
// 工具调用类型定义（与 OpenAI 兼容）
export type ToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

// 提取结果
export type ExtractResult = {
  text: string               // 当前可安全输出的纯文本
  toolCalls: ToolCall[]      // 本次 delta 中提取到的完整工具调用
  remaining: string          // 暂存区剩余未匹配内容（供调试）
}

/**
 * 全功能工具调用提取器
 * 支持多种格式：XML标签、代码块、函数调用、JSON对象等
 * 当无法匹配任何已知模式且缓冲区非空时，会回退将全部文本作为特殊工具调用提取
 */
export class ToolCallExtractor {
  // 原有缓冲区（用于遗留正则匹配）
  private buffer = "";
  private emittedTextLen = 0;
  private toolCallCounter = 0;
  private seenToolKeys = new Set<string>();
  // 新增：最终合并后的工具调用（同一语义只保留一个）
  private mergedToolCalls = new Map<string, ToolCall>();
  private pendingToolCalls = new Map<string, ToolCall>();  // key: 标准化签名 -> ToolCall
  // 追踪已经产出过的工具调用，避免 flush() 时重复产出
  private emittedToolKeys = new Set<string>();
  private inSentinel = false;
  private sentinelBuffer = "";        // 哨兵模式下累积的字符
  private readonly TOOL_TAG_OPEN = "<tool_calling>";
  private readonly TOOL_TAG_CLOSE = "</tool_calling>";
  constructor(private opts: { enableBashCodeBlock?: boolean } = {}) {}
  private emittedText = ""; // 仅用于调试
  // 新增哨兵模式属性
  private sentinelActive = false;
  private sentinelBuffer = "";
  private sentinelType: "tool" | "xml" | null = null; // 当前哨兵类型
  private readonly TOOL_PREFIX = "Tool:";              // 英文模式
  private readonly ARGS_PREFIX = "Arguments:";        // 参数前缀
  private readonly XML_OPEN = "<tool_calling>";        // XML 模式
  private readonly CN_PREFIX = "调用：";               // 中文模式（可扩展）

 /**
   * 尝试从哨兵缓冲区中提取完整的工具调用（针对 Tool: 格式）
   * 返回 { name, argsJson, endIndex } 或 null
   */
  private tryExtractToolFormat(): { name: string; argsJson: string; endIndex: number } | null {
    const buf = this.sentinelBuffer;
    // 查找 "Tool: Name\nArguments:"
    const toolMatch = /\bTool:\s*([a-zA-Z0-9_:]+)\s*\n\s*Arguments:\s*/i.exec(buf);
    if (!toolMatch) return null;
    const toolName = toolMatch[1];
    const argsStartIndex = toolMatch.index + toolMatch[0].length;
    // 从 argsStartIndex 开始查找完整的 JSON 对象
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let jsonEnd = -1;
    for (let i = argsStartIndex; i < buf.length; i++) {
      const ch = buf[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') braceCount++;
      else if (ch === '}') {
        braceCount--;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
    if (jsonEnd === -1) return null; // JSON 不完整
    const argsJson = buf.slice(argsStartIndex, jsonEnd);
    // 验证 JSON 合法性
    try { JSON.parse(argsJson); } catch { return null; }
    // 检查 JSON 之后是否跟着换行 + 另一个 "Tool:" 或字符串结束
    const after = buf.slice(jsonEnd);
    if (after.length > 0 && !/^\s*\n\s*Tool:/i.test(after) && !/^\s*$/.test(after)) {
      // 后面还有非空白非 Tool: 的内容，可能是同一个工具调用的后续？实际上这里应该允许后续内容
      // 保守起见，只要 JSON 完整且后面要么是空，要么是另一个 Tool: 开头，就认为完整
      if (!/^\s*\n\s*Tool:/i.test(after) && !/^\s*$/.test(after)) {
        // 但可能是同一个工具调用的更多参数？不，JSON 已闭合，多余内容应属于下一个工具或普通文本
        // 我们可以忽略多余内容，让它留到递归中处理
      }
    }
    return { name: toolName, argsJson, endIndex: jsonEnd };
  }

  /**
   * 尝试从哨兵缓冲区中提取完整的 XML 工具调用
   */
  private tryExtractXmlFormat(): { name: string; argsJson: string; endIndex: number } | null {
    const buf = this.sentinelBuffer;
    const openTag = this.XML_OPEN;
    const closeTag = "</tool_calling>";
    const openIdx = buf.indexOf(openTag);
    if (openIdx === -1) return null;
    const closeIdx = buf.indexOf(closeTag, openIdx + openTag.length);
    if (closeIdx === -1) return null;
    const inner = buf.substring(openIdx + openTag.length, closeIdx);
    const nameMatch = /<name>([\s\S]*?)<\/name>/i.exec(inner);
    const argsMatch = /<arguments>([\s\S]*?)<\/arguments>/i.exec(inner);
    if (!nameMatch || !argsMatch) return null;
    const name = nameMatch[1].trim();
    let argsJson = argsMatch[1].trim();
    const jsonMatch = argsJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) argsJson = jsonMatch[0];
    try { JSON.parse(argsJson); } catch { return null; }
    const endIndex = closeIdx + closeTag.length;
    return { name, argsJson, endIndex };
  }

  /**
   * 尝试提取中文格式（调用：工具名\n参数：{...}）
   * 类似可扩展
   */
  private tryExtractCnFormat(): { name: string; argsJson: string; endIndex: number } | null {
    const buf = this.sentinelBuffer;
    const cnMatch = /调用：\s*([a-zA-Z0-9_:]+)\s*\n\s*参数：\s*/i.exec(buf);
    if (!cnMatch) return null;
    const toolName = cnMatch[1];
    const argsStart = cnMatch.index + cnMatch[0].length;
    // 同样查找完整的 JSON 对象
    let braceCount = 0, inString = false, escape = false, end = -1;
    for (let i = argsStart; i < buf.length; i++) {
      const ch = buf[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') braceCount++;
      else if (ch === '}') {
        braceCount--;
        if (braceCount === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) return null;
    const argsJson = buf.slice(argsStart, end);
    try { JSON.parse(argsJson); } catch { return null; }
    return { name: toolName, argsJson, endIndex: end };
  }

  /**
   * 检测缓冲区开头是否可能是某个工具格式的前缀
   * 用于决定是否进入哨兵模式
   */
  private startsWithAnyPrefix(str: string): boolean {
    const prefixes = [this.TOOL_PREFIX, this.XML_OPEN, this.CN_PREFIX];
    for (const p of prefixes) {
      if (p.startsWith(str) || str.startsWith(p)) return true;
    }
    // 特殊：单个 '<' 可能是 XML 开始
    if (str === '<') return true;
    // 单个 'T' 可能是 "Tool:" 开始
    if (str === 'T') return true;
    return false;
  }

  private generateId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  /**
   * 哨兵模式：判断当前累积的字符串是否为完整工具调用
   * @returns 若匹配成功，返回 { name, argsJson, endIndex }；否则 null
   */
  private tryExtractCompleteToolCall(): { name: string; argsJson: string; endIndex: number } | null {
    const content = this.sentinelBuffer;
    const openTag = this.TOOL_TAG_OPEN;
    const closeTag = this.TOOL_TAG_CLOSE;
    const openIdx = content.indexOf(openTag);
    if (openIdx === -1) return null;
    const closeIdx = content.indexOf(closeTag, openIdx + openTag.length);
    if (closeIdx === -1) return null;

    // 提取 <name>...</name> 和 <arguments>...</arguments>
    const inner = content.substring(openIdx + openTag.length, closeIdx);
    const nameMatch = /<name>([\s\S]*?)<\/name>/i.exec(inner);
    const argsMatch = /<arguments>([\s\S]*?)<\/arguments>/i.exec(inner);
    if (!nameMatch || !argsMatch) return null;

    const name = nameMatch[1].trim();
    let argsJson = argsMatch[1].trim();
    // 尝试提取 JSON 对象（可能被额外的空白或换行包围）
    const jsonMatch = argsJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) argsJson = jsonMatch[0];
    // 验证是否为合法 JSON
    try {
      JSON.parse(argsJson);
    } catch {
      return null;
    }
    const endIndex = closeIdx + closeTag.length;
    return { name, argsJson, endIndex };
  }

  /**
   * 哨兵模式：判断当前累积的字符串是否仍有可能成为合法前缀
   * 例如：已有 "<"、"<t"、"<to" 等都是前缀，而 "<x" 则不可能。
   */
  private isPossiblePrefix(): boolean {
    const content = this.sentinelBuffer;
    const tag = this.TOOL_TAG_OPEN;
    // 如果 content 长度小于 tag 长度，检查 content 是否是 tag 的前缀
    if (content.length <= tag.length) {
      return tag.startsWith(content);
    }
    // 如果已经超过 tag 长度，检查是否包含完整的 open tag 前缀
    // 但更简单的逻辑：只要没有出现不匹配的字符，就继续等待
    // 这里我们只检查最短前缀：如果 content 以 "<" 开头，且后续字符与 tag 不冲突
    for (let i = 0; i < Math.min(content.length, tag.length); i++) {
      if (content[i] !== tag[i]) {
        return false;
      }
    }
    // 如果已经包含完整的 open tag，但还没闭合，也是可能的
    if (content.includes(this.TOOL_TAG_OPEN)) {
      return true;
    }
    return true; // 默认可能
  }

  /**
   * 将原始工具名规范化为系统期望的名称（首字母大写，去除命名空间前缀）
   */
  private normalizeToolName(name: string): string {
    const base = name.includes(':') ? name.split(':').pop() || name : name;
    const mapping: Record<string, string> = {
        "bash": "Bash",
        "cmd": "Bash",
        "shell": "Bash",
        "powershell": "Bash",
        "batch": "Bash",
        "glob": "Glob",
				 "find": "Glob",  
				 
        "read": "Read",
				"cat": "Read", 
        "grep": "Grep",
				"findstr": "Grep",     // 添加：Windows findstr 映射到 Grep
        "write": "Write",
        "edit": "Edit",  
				"ls": "ListFiles",     // 添加：ls 映射到 ListFiles
			  "dir": "ListFiles",    // 添加：dir 映射到 ListFiles
        "listfiles": "ListFiles",   // 关键修改
        "web_search": "WebSearch",
        "code_interpreter": "CodeInterpreter",
        "web_extractor": "WebExtractor",
        "str_replace_editor": "StrReplaceEditor",
    };
    const lower = base.toLowerCase();
    if (mapping[lower]) return mapping[lower];
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
 /**
   * 生成工具调用的标准化签名（用于去重合并）
   */
  private getToolCallKey(toolCall: ToolCall): string {
    const name = toolCall.function.name.toLowerCase();
    // 对参数进行归一化处理
    let argsNormalized = "";
    try {
      const args = JSON.parse(toolCall.function.arguments);
      // 对于参数结构不同但语义相同的工具，进行归一化
      if (name === "listfiles" || name === "ListFiles") {
        // 将 directory/path/filePath 统一为 directory
        if (args.directory || args.path || args.filePath) {
          argsNormalized = `directory=${args.directory || args.path || args.filePath}`;
        } else {
          argsNormalized = "directory=.";
        }
      } else if (name === "glob" || name === "find") {
        // Glob 和 Find 统一处理
        argsNormalized = `pattern=${args.pattern || args.name}`;
      } else if (name === "bash" || name === "shell" || name === "cmd") {
        // 所有 shell 类命令统一为 Bash
        argsNormalized = `command=${args.command || args.cmd}`;
      } else {
        // 其他工具：使用参数 JSON 的规范化字符串
        argsNormalized = JSON.stringify(args, Object.keys(args).sort());
      }
    } catch {
      argsNormalized = toolCall.function.arguments;
    }
    return `${name}:${argsNormalized}`;
  }

  /**
   * 合并两个工具调用（当发现重复时，将新发现的参数合并到已有的调用中）
   */
  private mergeToolCalls(existing: ToolCall, incoming: ToolCall): ToolCall {
    // 如果参数是 JSON 对象，进行深度合并
    try {
      const existingArgs = JSON.parse(existing.function.arguments);
      const incomingArgs = JSON.parse(incoming.function.arguments);
      const mergedArgs = { ...existingArgs, ...incomingArgs };
      return {
        ...existing,
        function: {
          ...existing.function,
          arguments: JSON.stringify(mergedArgs),
        },
      };
    } catch {
      // 如果解析失败，优先保留参数更完整的那个
      if (incoming.function.arguments.length > existing.function.arguments.length) {
        return incoming;
      }
      return existing;
    }
  }

  /**
   * 尝试将工具调用添加到合并缓冲区
   * 如果已存在相同 key 的工具调用，则进行合并而非重复添加
   * 如果该工具调用已经被产出过，则不再产出
   */
  private addOrMergeToolCall(toolCall: ToolCall): ToolCall[] {
    const key = this.getToolCallKey(toolCall);
    const existing = this.pendingToolCalls.get(key);

    // 如果已经产出过这个工具调用，直接跳过
    if (this.emittedToolKeys.has(key)) {
      logForDebugging(`[ToolCallExtractor] 跳过已产出的工具调用: ${key}`, { level: 'debug' });
      return [];
    }

    if (existing) {
      // 存在重复，进行合并
      const merged = this.mergeToolCalls(existing, toolCall);
      this.pendingToolCalls.set(key, merged);
      logForDebugging(`[ToolCallExtractor] 合并工具调用: ${key}`, { level: 'debug' });
      return [];  // 不产生新的工具调用，已合并到现有
    } else {
      // 新工具调用，添加到缓冲区
      this.pendingToolCalls.set(key, toolCall);
      // 标记为已产出
      this.emittedToolKeys.add(key);
      logForDebugging(`[ToolCallExtractor] 首次产出工具调用: ${key}`, { level: 'debug' });
      return [toolCall];  // 首次出现时返回
    }
  }


  private makeToolCall(name: string, args: unknown): ToolCall {
    const normalizedName = this.normalizeToolName(name);
    let finalArgs = args;
    if (normalizedName === "Bash" && typeof finalArgs === "object" && finalArgs !== null) {
        const cmd = (finalArgs as any).command ?? (finalArgs as any).cmd;
        if (cmd !== undefined) {
            finalArgs = { command: String(cmd) };
        }
    }
    const toolCall: ToolCall = {
        id: `call_${this.generateId()}_${++this.toolCallCounter}`,
        type: "function",
        function: {
            name: normalizedName,
            arguments: typeof finalArgs === "string" ? finalArgs : JSON.stringify(finalArgs ?? {}),
        },
    };
		logForDebugging(`[ToolCallExtractor] 生成工具调用: name=${normalizedName}, args=${toolCall.function.arguments}`, { level: 'debug' });
    return toolCall;
  }
	private inferToolNameFromArgs(args: any): string | null {
		if (!args || typeof args !== "object") return null;
		if (args.tool && typeof args.tool === "string") return args.tool;
		if (args.name && typeof args.name === "string") return args.name;
		
		// 优先推断有明确特征的工具
		if (args.command !== undefined || args.cmd !== undefined) return "Bash";
		if (args.code !== undefined) return "CodeInterpreter";
    if (args.queries !== undefined || args.query !== undefined) return "WebSearch";
		if (args.url !== undefined || args.urls !== undefined) return "WebExtractor";
		if (args.file_path !== undefined || args.filePath !== undefined) return "Read";
		
		// 新增：识别文件搜索类工具
		if (args.pattern !== undefined) {
			if (args.path === undefined || args.path === "" || args.recursive === true) {
				return "Glob";
			}
			return "Grep";
		}
		
		// 新增：识别目录列表工具
		if (args.directory !== undefined || args.dir !== undefined) {
			return "ListFiles";
		}
		
		// 新增：识别文本编辑器工具
		if ((args.old_string !== undefined || args.new_string !== undefined) && args.path) {
			return "StrReplaceEditor";
		}
		
		return null;
	}

  private normalizeToolCall(parsed: any): ToolCall | null {
    if (!parsed || typeof parsed !== "object") return null;
    // 辅助函数：获取参数对象
    // excludeKey 是要排除的工具名字段（如 'name'、'tool'、'function'）
    const extractArgs = (obj: any, excludeKey: string): any => {
      // 优先使用专门的参数字段
      const argsField = obj.arguments ?? obj.parameters ?? obj.params;
      if (argsField && typeof argsField === "object") {
        return argsField;
      }
      // 否则，排除工具名字段后，其余字段都作为参数
      const { [excludeKey]: _, ...rest } = obj;
      return rest;
    };
    // 情况1：{ name: "ToolName", ... }
    if (parsed.name && typeof parsed.name === "string") {
      const args = extractArgs(parsed, "name");
      return this.makeToolCall(parsed.name, args);
    }
    // 情况2：{ tool: "ToolName", ... }
    if (parsed.tool && typeof parsed.tool === "string") {
      const args = extractArgs(parsed, "tool");
      return this.makeToolCall(parsed.tool, args);
    }
    // 情况3：{ function: "ToolName", arguments: {...} }（极少见）
    if (parsed.function && typeof parsed.function === "string") {
      const args = extractArgs(parsed, "function");
      return this.makeToolCall(parsed.function, args);
    }
    // 情况4：根据参数推断工具名（兜底）
    const inferredName = this.inferToolNameFromArgs(parsed);
    if (inferredName) {
      return this.makeToolCall(inferredName, parsed);
    }
    return null;
  }

  private readBalancedJson(text: string, start: number): { json: string; end: number } | null {
    logForDebugging(`[ToolCallExtractor] readBalancedJson 调用: start=${start}, text前50字符: ${text.slice(start, start+50)}`, { level: 'debug' });
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) return null;
    const open = text[i];
    if (open !== '{' && open !== '[') return null;
    const close = open === '{' ? '}' : ']';
    let stack = 0;
    let inString = false;
    let escape = false;
    for (let pos = i; pos < text.length; pos++) {
        const ch = text[pos];
        if (inString) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = false; continue; }
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === open) { stack++; }
      else if (ch === close) { stack--; if (stack === 0) return { json: text.slice(i, pos + 1), end: pos + 1 }; }
    }
    return null;
  }

  private detectBacktickCodeBlock(): { start: number; end: number; language: string; content: string } | null {
    const text = this.buffer;
    let i = 0;
    while (i < text.length) {
      if (text[i] === '`') {
        let start = i;
        let backtickCount = 0;
        while (i < text.length && text[i] === '`') { backtickCount++; i++; }
        if (backtickCount >= 3) {
          let langStart = i;
          while (langStart < text.length && /\s/.test(text[langStart])) langStart++;
          let langEnd = langStart;
          while (langEnd < text.length && /[a-zA-Z0-9_-]/.test(text[langEnd])) langEnd++;
          const language = langEnd > langStart ? text.slice(langStart, langEnd).toLowerCase() : "";
          let contentStart = langEnd;
          while (contentStart < text.length && /\s/.test(text[contentStart])) contentStart++;
          if (contentStart >= text.length) return null;
          let j = contentStart;
          let endBacktickStart = -1;
          while (j < text.length) {
            if (text[j] === '`') {
              let cnt = 0;
              const btStart = j;
              while (j < text.length && text[j] === '`') { cnt++; j++; }
              if (cnt >= 3) { endBacktickStart = btStart; break; }
            } else { j++; }
          }
          if (endBacktickStart === -1) return null;
          const content = text.slice(contentStart, endBacktickStart).trimEnd();
          return { start, end: endBacktickStart + 3, language, content };
        }
      } else { i++; }
    }
    return null;
  }

  private findToolCall(): { start: number; end: number; toolCall: ToolCall } | null {
    const text = this.buffer;
    // 优先匹配 {"name": "ToolName", "arguments": {...}} 格式
    // 正则说明：匹配以 {"name": " 开头，跨行匹配直到 } 结束的完整 JSON 对象
    const jsonToolPattern = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/i;
    let toolNameMatch = jsonToolPattern.exec(text);
    if (!toolNameMatch) {
      // 尝试匹配可能被 markdown 代码块包围的情况
      const codeBlockPattern = /```(?:json)?\s*\r?\n?(\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\})\s*\r?\n?```/i;
      const blockMatch = codeBlockPattern.exec(text);
      if (blockMatch) {
        toolNameMatch = [blockMatch[0], blockMatch[1], ...blockMatch.slice(2)];
        toolNameMatch.index = blockMatch.index;
      }
    }
    if (toolNameMatch) {
      const fullJson = toolNameMatch[0];
      const toolName = toolNameMatch[1];
      let argsStr = toolNameMatch[2];
      // 确保 arguments 内部的 JSON 是平衡的（可能包含嵌套对象）
      const balancedArgs = this.readBalancedJson(argsStr, 0);
      if (balancedArgs) {
        try {
          const args = JSON.parse(balancedArgs.json);
          logForDebugging(`[ToolCallExtractor] 匹配到工具 JSON: ${toolName}`, { level: 'debug' });
          return {
            start: toolNameMatch.index,
            end: toolNameMatch.index + fullJson.length,
            toolCall: this.makeToolCall(toolName, args),
          };
        } catch (e) {
          logForDebugging(`[ToolCallExtractor] 解析 arguments 失败: ${e.message}`, { level: 'debug' });
        }
      }
    }
    // 优先匹配 {"name": "ToolName", "arguments": {...}} 格式
    const jsonToolPattern1 = /\{\s*"name"\s*:\s*"/i;
    const jsonToolMatch = jsonToolPattern1.exec(text);
    if (jsonToolMatch) {
      const start = jsonToolMatch.index;
      const balanced = this.readBalancedJson(text, start);
      if (balanced) {
        try {
          const parsed = JSON.parse(balanced.json);
          if (parsed.name && typeof parsed.name === 'string' && parsed.arguments) {
            return {
              start,
              end: balanced.end,
              toolCall: this.makeToolCall(parsed.name, parsed.arguments),
            };
          }
        } catch (e) {
          logForDebugging(`[ToolCallExtractor] 解析工具 JSON 失败: ${e.message}`, { level: 'debug' });
        }
      }
    }
    // 优先匹配 {"tool": "ToolName", "arguments": {...}} 格式
    const jsonToolWithToolField = /\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/i;
    let toolMatch = jsonToolWithToolField.exec(text);
    if (!toolMatch) {
      // 尝试匹配可能被 markdown 代码块包围的情况
      const codeBlockPattern = /```(?:json)?\s*\r?\n?(\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\})\s*\r?\n?```/i;
      const blockMatch = codeBlockPattern.exec(text);
      if (blockMatch) {
        toolMatch = [blockMatch[0], blockMatch[1], ...blockMatch.slice(2)];
        toolMatch.index = blockMatch.index;
      }
    }
    if (toolMatch) {
      const fullJson = toolMatch[0];
      const toolName = toolMatch[1];
      let argsStr = toolMatch[2];
      const balancedArgs = this.readBalancedJson(argsStr, 0);
      if (balancedArgs) {
        try {
          const args = JSON.parse(balancedArgs.json);
          logForDebugging(`[ToolCallExtractor] 匹配到工具 JSON (tool字段): ${toolName}`, { level: 'debug' });
          return {
            start: toolMatch.index,
            end: toolMatch.index + fullJson.length,
            toolCall: this.makeToolCall(toolName, args),
          };
        } catch (e) {
          logForDebugging(`[ToolCallExtractor] 解析 arguments 失败: ${e.message}`, { level: 'debug' });
        }
      }
    }
    // 模式0: 反引号代码块 (bash/cmd等)
    const backtickBlock = this.detectBacktickCodeBlock();
    if (backtickBlock) {
      const { language, content, start, end } = backtickBlock;
      if (["cmd", "bash", "Bash", "shell", "sh", "powershell", "batch", "ps1"].includes(language)) {
        const command = content.trim();
        if (command) {
          return { start, end, toolCall: this.makeToolCall("bash", { command }) };
        }
      }
    }
    // **关键修复：移除容易误判的行首命令模式** 
    // 原 commandPrefixPattern 会导致自然语言中的命令动词被提前当作工具调用，从而切断完整命令行。
    // 因此将其注释掉，让自然语言命令通过其他格式（如 XML、Tool: 或 JSON）处理。
    // 如果未来需要支持，建议改为检测更完整的模式。
    /*
    const commandPrefixPattern = /^\s*(?:findstr|cd|dir|git|grep|ls|pwd|echo|cat|head|tail|wc|sort|uniq|awk|sed|tar|zip|unzip|chmod|chown|ps|kill|rm|cp|mv|mkdir|rmdir|touch|which|where|type)\s+([^\n]*)/im;
    const cmdMatch = commandPrefixPattern.exec(text);
    if (cmdMatch) {
      const command = cmdMatch[0].trim();
      return {
        start: cmdMatch.index,
        end: cmdMatch.index + command.length,
        toolCall: this.makeToolCall("Bash", { command }),
      };
    }
    */

    // 模式2: <tool_call name="ToolName">...</tool_call> (最重要，匹配日志中的格式)
    const toolCallAttr = /<tool_call\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/i.exec(text);
    if (toolCallAttr) {
      const toolName = toolCallAttr[1];
      const inner = toolCallAttr[2].trim();
      let args: any;
      try {
        // 尝试解析内部 JSON
        args = JSON.parse(inner);
      } catch {
        // 如果不是纯 JSON，可能包含其他 XML 标签，尝试提取参数
        args = {};
        const paramRegex = /<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/gi;
        let paramMatch;
        while ((paramMatch = paramRegex.exec(inner)) !== null) {
          const key = paramMatch[1];
          let value = paramMatch[2].trim();
          if (value === "true") value = true;
          else if (value === "false") value = false;
          else if (!isNaN(Number(value))) value = Number(value);
          args[key] = value;
        }
        if (Object.keys(args).length === 0 && inner) args = { raw: inner };
      }
      return {
        start: toolCallAttr.index,
        end: toolCallAttr.index + toolCallAttr[0].length,
        toolCall: this.makeToolCall(toolName, args),
      };
    }
		// 模式: <tool_call><name>ToolName</name><arguments>...</arguments></tool_call>
		const toolCallNested = /<tool_call>\s*<name>([^<]+)<\/name>\s*<arguments>([\s\S]*?)<\/arguments>\s*<\/tool_call>/i.exec(text);
		if (toolCallNested) {
			const toolName = toolCallNested[1].trim();
			const argsStr = toolCallNested[2].trim();
			try {
				const args = JSON.parse(argsStr);
				return { start: toolCallNested.index, end: toolCallNested.index + toolCallNested[0].length, toolCall: this.makeToolCall(toolName, args) };
			} catch {}
		}
  // ========== 新增模式：裸 JSON 对象，根据字段推断工具名 ==========
    // 匹配一个完整的顶级 JSON 对象（以 { 开头，以 } 结尾）
    const jsonObjectMatch = /^\s*(\{[\s\S]*?\})\s*([\s\S]*)$/m.exec(text);
    if (jsonObjectMatch) {
      const jsonStr = jsonObjectMatch[1];
      const afterJson = jsonObjectMatch[2];
      // 确保 JSON 是完整且平衡的
      const balanced = this.readBalancedJson(text, text.indexOf(jsonStr));
      if (balanced && balanced.json === jsonStr) {
        try {
          const args = JSON.parse(jsonStr);
          // 根据参数推断工具名
          const inferredName = this.inferToolNameFromArgs(args);
          if (inferredName) {
            // 可选：如果推断的是 grep，且参数中包含 pattern/path/output_mode 等，则确认
            // 注意：不要求参数严格匹配，只要有合理特征就提取
            return {
              start: 0,
              end: balanced.end,
              toolCall: this.makeToolCall(inferredName, args),
            };
          }
        } catch {}
      }
    }
    // 模式5: <bash>...</bash>（修正变量错误）
    const bashXml = /<bash>\s*\n?([\s\S]*?)\n?\s*<\/bash>/i.exec(text);
    if (bashXml) {
      const inner = bashXml[1];
      // 优先提取 <command> 子标签
      const commandMatch = /<command>([\s\S]*?)<\/command>/i.exec(inner);
      let command = commandMatch ? commandMatch[1].trim() : inner.trim();
      const descMatch = /<description>([\s\S]*?)<\/description>/i.exec(inner);
      const args: any = { command };
      if (descMatch) args.description = descMatch[1].trim();
      if (command) {
        return {
          start: bashXml.index,
          end: bashXml.index + bashXml[0].length,
          toolCall: this.makeToolCall("Bash", args),
        };
      }
    }
    // 模式14: 工具名: {JSON}
    const colonJsonPattern = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(\{[\s\S]*?\})/m;
    const colonMatch = colonJsonPattern.exec(text);
    if (colonMatch) {
      const toolName = colonMatch[1];
      const braceIdx = text.indexOf('{', colonMatch.index + colonMatch[1].length);
      if (braceIdx !== -1) {
        const balanced = this.readBalancedJson(text, braceIdx);
        if (balanced) {
          try {
            const args = JSON.parse(balanced.json);
            return {
              start: colonMatch.index,
              end: balanced.end,
              toolCall: this.makeToolCall(toolName, args),
            };
          } catch {}
        }
      }
    }
    // 模式13: <tool_calling> 标签（包含 <name> 和 <arguments>）
    const toolCallingTag = /<tool_calling>([\s\S]*?)<\/tool_calling>/i.exec(text);
    if (toolCallingTag) {
      const inner = toolCallingTag[1];
      const nameMatch = /<name>(.*?)<\/name>/i.exec(inner);
      const argsMatch = /<arguments>(.*?)<\/arguments>/is.exec(inner);
      if (nameMatch && argsMatch) {
        let toolName = nameMatch[1].trim();
        if (toolName.includes(':')) toolName = toolName.split(':').pop() || toolName;
        let argsStr = argsMatch[1].trim();
        try {
          let args = JSON.parse(argsStr);
          return {
            start: toolCallingTag.index,
            end: toolCallingTag.index + toolCallingTag[0].length,
            toolCall: this.makeToolCall(toolName, args),
          };
        } catch {
          // 如果 JSON 解析失败，仍然尝试提取原始字符串作为参数（针对简单命令）
          return {
            start: toolCallingTag.index,
            end: toolCallingTag.index + toolCallingTag[0].length,
            toolCall: this.makeToolCall(toolName, { raw: argsStr }),
          };
        }
      }
    }
    // 模式11: Tool: Name\nArguments: {...}
    const toolArgsPrefix = /\bTool:\s*([a-zA-Z0-9_:]+)\s*\nArguments:\s*/i;
    const prefixMatch = toolArgsPrefix.exec(text);
    if (prefixMatch) {
      const toolName = prefixMatch[1];
      const jsonStartIdx = prefixMatch.index + prefixMatch[0].length;
      logForDebugging(`[ToolCallExtractor] 匹配到 Tool: 模式, toolName=${toolName}, jsonStartIdx=${jsonStartIdx}`, { level: 'debug' });
      // 提取从 jsonStartIdx 开始的完整 JSON 对象（不使用 readBalancedJson，因为可能跨多行）
      let jsonText = text.slice(jsonStartIdx);
      const firstBrace = jsonText.indexOf('{');
      if (firstBrace !== -1) {
        jsonText = jsonText.slice(firstBrace);
        let braceCount = 0;
        let inString = false;
        let escape = false;
        let endIdx = -1;
        for (let i = 0; i < jsonText.length; i++) {
          const ch = jsonText[i];
          if (inString) {
            if (escape) escape = false;
            else if (ch === '\\') escape = true;
            else if (ch === '"') inString = false;
            continue;
          }
          if (ch === '"') {
            inString = true;
            continue;
          }
          if (ch === '{') braceCount++;
          if (ch === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIdx = i + 1;
              break;
            }
          }
        }
        if (endIdx !== -1) {
          const jsonCandidate = jsonText.slice(0, endIdx);
          // 增强完整性检查：JSON 之后必须是换行+下一个"Tool:"或者文本结束
          const afterJson = jsonText.slice(endIdx);
          const isComplete = afterJson.trim().length === 0 || /^\s*\n\s*Tool:/i.test(afterJson);
          if (isComplete) {
            try {
              const args = JSON.parse(jsonCandidate);
              logForDebugging(`[ToolCallExtractor] 成功解析 JSON: ${JSON.stringify(args).slice(0, 200)}`, { level: 'debug' });
              let finalToolName = toolName;
              const lowerName = toolName.toLowerCase();
              const knownTools = ["bash","glob","read","grep","write","edit","listfiles","web_search","code_interpreter","web_extractor","str_replace_editor"];
              if (!knownTools.includes(lowerName)) {
                const inferred = this.inferToolNameFromArgs(args);
                if (inferred) finalToolName = inferred;
                logForDebugging(`[ToolCallExtractor] 推断工具名: ${toolName} -> ${finalToolName}`, { level: 'debug' });
              }
              return {
                start: prefixMatch.index,
                end: jsonStartIdx + firstBrace + endIdx,
                toolCall: this.makeToolCall(finalToolName, args),
              };
            } catch (e) {
              logForDebugging(`[ToolCallExtractor] JSON 解析失败: ${e.message}, 候选文本: ${jsonCandidate.slice(0, 200)}`, { level: 'debug' });
            }
          } else {
            logForDebugging(`[ToolCallExtractor] JSON 不完整，等待更多数据`, { level: 'debug' });
          }
        } else {
          logForDebugging(`[ToolCallExtractor] 未找到完整的 JSON 对象，jsonText 前200字符: ${jsonText.slice(0, 200)}`, { level: 'debug' });
        }
      } else {
        logForDebugging(`[ToolCallExtractor] 在 Arguments 后面未找到 '{' 字符，jsonText 前200字符: ${jsonText.slice(0, 200)}`, { level: 'debug' });
      }
    }
		const toolCallingPattern = /<tool_calling>\s*<name>([^<]+)<\/name>\s*<arguments>([\s\S]*?)<\/arguments>\s*<\/tool_calling>/i;
		const toolCallingMatch = toolCallingPattern.exec(text);
		if (toolCallingMatch) {
				const toolName = toolCallingMatch[1].trim();
				let argsStr = toolCallingMatch[2].trim();
				// 尝试解析 JSON
				try {
						const args = JSON.parse(argsStr);
						return {
								start: toolCallingMatch.index,
								end: toolCallingMatch.index + toolCallingMatch[0].length,
								toolCall: this.makeToolCall(toolName, args),
						};
				} catch (e) {
						// 解析失败，忽略
				}
		}
    // 模式12: 嵌套 XML 工具调用 <tool_call><ToolName>...</ToolName></tool_call>
    const nestedToolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    let nestedMatch;
    while ((nestedMatch = nestedToolCallRegex.exec(text)) !== null) {
      const fullMatch = nestedMatch[0];
      const inner = nestedMatch[1];
      const toolNameMatch = /<([a-zA-Z0-9_]+)>/.exec(inner);
      if (toolNameMatch) {
        const toolName = toolNameMatch[1];
        const closeTag = `</${toolName}>`;
        const closeIdx = inner.indexOf(closeTag);
        if (closeIdx !== -1) {
          const argsXml = inner.slice(toolNameMatch.index + toolNameMatch[0].length, closeIdx);
          const args: Record<string, string> = {};
          const paramRegex = /<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/g;
          let paramMatch;
          while ((paramMatch = paramRegex.exec(argsXml)) !== null) {
            args[paramMatch[1]] = paramMatch[2].trim();
          }
          return {
            start: nestedMatch.index,
            end: nestedMatch.index + fullMatch.length,
            toolCall: this.makeToolCall(toolName, args),
          };
        }
      }
    }
		
 
    // 模式1: Calling: ToolName {...}
    const calling = /(?:^|[\s\u25CF\u276F\-*])\bCalling:\s*(\w+)\s+/.exec(text);
    if (calling) {
      const jsonStart = calling.index + calling[0].length;
      const balanced = this.readBalancedJson(text, jsonStart);
      if (balanced) {
        try {
          const raw = JSON.parse(balanced.json);
          const toolName = calling[1];
          let args: any = raw;
          switch (toolName.toLowerCase()) {
            case "bash":
            case "Bash":
              args = { command: String(raw.command ?? raw.cmd ?? "") };
              break;
            case "web_search":
            case "WebSearch":
              args = { queries: Array.isArray(raw.queries) ? raw.queries.map(String) : raw.query ? [String(raw.query)] : [] };
              break;
            case "code_interpreter":
            case "CodeInterpreter":
              args = { code: String(raw.code ?? ""), description: String(raw.description ?? "") };
              break;
            case "web_extractor":
            case "WebExtractor":
              args = { urls: Array.isArray(raw.urls) ? raw.urls.map(String) : [], goal: String(raw.goal ?? "") };
              break;
					  case "StrReplaceEditor":
					  case "str_replace_editor":
							args = {
									command: String(raw.command ?? ""),
									path: String(raw.path ?? raw.file_path ?? ""),
									old_string: String(raw.old_string ?? ""),
									new_string: String(raw.new_string ?? ""),
									...(raw.view_range ? { view_range: raw.view_range } : {})
							};
							break;

					// 以下工具参数通常无需转换，直接使用 raw
					case "read":
					case "write":
					case "edit":
					case "glob":
					case "grep":
					case "listfiles":
							args = raw;
							break;
          }
          return { start: calling.index, end: balanced.end, toolCall: this.makeToolCall(toolName, args) };
        } catch {}
      }
    }
    // 模式2.5: <tool_call>...</tool_call> (纯 JSON)
    const toolCallNoAttr = /<tool_call>([\s\S]*?)<\/tool_call>/i.exec(text);
    if (toolCallNoAttr) {
      try {
        const inner = toolCallNoAttr[1].trim();
        const parsed = JSON.parse(inner);
        const tc = this.normalizeToolCall(parsed);
        if (tc) {
          return { start: toolCallNoAttr.index, end: toolCallNoAttr.index + toolCallNoAttr[0].length, toolCall: tc };
        }
      } catch {}
    }
    // 模式3: <tool>...</tool>
    const toolTag = /<tool>([\s\S]*?)<\/tool>/i.exec(text);
    if (toolTag) {
      try {
        const parsed = JSON.parse(toolTag[1].trim());
        const tc = this.normalizeToolCall(parsed);
        if (tc) {
          return { start: toolTag.index, end: toolTag.index + toolTag[0].length, toolCall: tc };
        }
      } catch {}
    }
    // 模式4: <function_calls>...</function_calls> (XML 格式)
    const functionCallsRegex = /<function_calls>([\s\S]*?)<\/function_calls>/gi;
    let fcMatch;
    while ((fcMatch = functionCallsRegex.exec(text)) !== null) {
      const fullMatch = fcMatch[0];
      const inner = fcMatch[1];
      // 尝试解析 XML 格式的 <function_call>
      const functionCallRegex = /<function_call\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/function_call>/gi;
      let innerMatch;
      while ((innerMatch = functionCallRegex.exec(inner)) !== null) {
        const toolName = innerMatch[1];
        const fcInner = innerMatch[2];
        // 解析内部的 <parameter> 标签，提取参数名和值
        const paramRegex = /<parameter\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
        const args: Record<string, any> = {};
        let paramMatch;
        while ((paramMatch = paramRegex.exec(fcInner)) !== null) {
          const paramName = paramMatch[1];
          let paramValue = paramMatch[2].trim();
          // 尝试将参数值转换为合适的类型（数字、布尔等）
          if (paramValue === "true") paramValue = true;
          else if (paramValue === "false") paramValue = false;
          else if (!isNaN(Number(paramValue))) paramValue = Number(paramValue);
          args[paramName] = paramValue;
        }
        if (Object.keys(args).length === 0 && fcInner.trim()) args["raw"] = fcInner.trim();
        return {
          start: fcMatch.index,
          end: fcMatch.index + fullMatch.length,
          toolCall: this.makeToolCall(toolName, args),
        };
      }
      // 回退：内部为 JSON 数组
      try {
        const parsed = JSON.parse(inner.trim());
        const tc = this.normalizeToolCall(Array.isArray(parsed) ? parsed[0] : parsed);
        if (tc) {
          return { start: fcMatch.index, end: fcMatch.index + fullMatch.length, toolCall: tc };
        }
      } catch {}
    }
    // 模式5: <bash>...</bash>
    const bashXml1 = /<bash>\s*\n?([\s\S]*?)\n?\s*<\/bash>/i.exec(text);
    if (bashXml1) {
      const command = bashXml1[1].trim();
      if (command) {
        return {
          start: bashXml1.index,
          end: bashXml1.index + bashXml1[0].length,
          toolCall: this.makeToolCall("bash", { command })
        };
      }
    }
    // 模式6: bash/shell 代码块（可选）
    if (this.opts.enableBashCodeBlock) {
      const bashBlock = /```(?:bash|batch|shell|sh|cmd|powershell)\s*\r?\n([\s\S]*?)\r?\n```/i.exec(text);
      if (bashBlock) {
        const command = bashBlock[1].trim();
        if (command && command.split(/[\r\n]+/).length <= 2 && !/(?:#[^!]|&&|\|\||>>?|<\(|echo\s+["']|printf\s+["']|--help)/i.test(command)) {
          return { start: bashBlock.index, end: bashBlock.index + bashBlock[0].length, toolCall: this.makeToolCall("bash", { command }) };
        }
      }
    }
    // 模式7: Glob(...), Bash(...), Read(...) 等函数调用
    const fnPattern = /\b(Glob|Bash|Read|Grep|Write|Edit|ListFiles|CodeInterpreter|WebExtractor)\s*\(/i;
    const fn = fnPattern.exec(text);
    if (fn) {
      const jsonStart = fn.index + fn[0].length;
      const balanced = this.readBalancedJson(text, jsonStart);
      if (balanced) {
        const afterJson = text.slice(balanced.end);
        const closeMatch = /^\s*\)/.exec(afterJson);
        if (closeMatch) {
          try {
            const args = JSON.parse(balanced.json);
            const toolName = fn[1];
            return { start: fn.index, end: balanced.end + closeMatch[0].length, toolCall: this.makeToolCall(toolName, args) };
          } catch {}
        }
      }
    }
    // 模式8: ```json ... ``` 代码块
    const jsonBlock = /```(?:json)?\s*\r?\n\s*([\[{][\s\S]*?[\]}])\s*\r?\n```/i.exec(text);
    if (jsonBlock) {
      try {
        const parsed = JSON.parse(jsonBlock[1].trim());
        const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
        const tc = this.normalizeToolCall(candidate) ?? (() => {
          const inferred = this.inferToolNameFromArgs(candidate);
          return inferred ? this.makeToolCall(inferred, candidate) : null;
        })();
        if (tc) {
          return { start: jsonBlock.index, end: jsonBlock.index + jsonBlock[0].length, toolCall: tc };
        }
      } catch {}
    }
    // 模式9: 中文格式 [调用 ToolName] {...}
    const chinese = /\[调用\s+(\w+)\]\s*/.exec(text);
    if (chinese) {
      const jsonStart = chinese.index + chinese[0].length;
      const balanced = this.readBalancedJson(text, jsonStart);
      if (balanced) {
        try {
          const args = JSON.parse(balanced.json);
          return { start: chinese.index, end: balanced.end, toolCall: this.makeToolCall(chinese[1], args) };
        } catch {}
      }
    }
		// 增强中文格式：[调用 ToolName] {JSON}
		const cnBracket = /\[调用\s+([^\]]+)\]\s*(\{[\s\S]*?\})/;
		const cnMatch = cnBracket.exec(text);
		if (cnMatch) {
			const toolName = cnMatch[1].trim();
			const jsonStart = cnMatch.index + cnMatch[0].indexOf('{');
			const balanced = this.readBalancedJson(text, jsonStart);
			if (balanced) {
				try {
					const args = JSON.parse(balanced.json);
					return {
						start: cnMatch.index,
						end: balanced.end,
						toolCall: this.makeToolCall(toolName, args),
					};
				} catch {}
			}
		}
    // 模式10: 行内 JSON 对象
    const inlineStart = text.search(/\{[\s\S]*?(?:"name"\s*:\s*"[^"]+"|"tool"\s*:\s*"[^"]+")[\s\S]*?(?:"arguments"|"parameters")/);
    if (inlineStart >= 0) {
      const balanced = this.readBalancedJson(text, inlineStart);
      if (balanced) {
        try {
          const raw = JSON.parse(balanced.json);
          const tc = this.normalizeToolCall(raw);
          if (tc) {
            return { start: inlineStart, end: balanced.end, toolCall: tc };
          }
        } catch {}
      }
    }
    // 模式16: Anthropic Action 风格
    // 匹配 "Action: ToolName" 后跟 "Action Input: {JSON}"
    const actionPattern = /\bAction:\s*([a-zA-Z0-9_]+)\s*\n\s*Action Input:\s*/i;
    const actionMatch = actionPattern.exec(text);
    if (actionMatch) {
        const toolName = actionMatch[1];
        const jsonStartIndex = actionMatch.index + actionMatch[0].length;
        const balanced = this.readBalancedJson(text, jsonStartIndex);
        if (balanced) {
            try {
                const args = JSON.parse(balanced.json);
                return {
                    start: actionMatch.index,
                    end: balanced.end,
                    toolCall: this.makeToolCall(toolName, args),
                };
            } catch (e) {
                logForDebugging(`[ToolCallExtractor] 解析 Action Input JSON 失败: ${e.message}`, { level: 'debug' });
            }
        }
    }
    // 模式16: Anthropic Action 风格 (Action: ToolName\nAction Input: {JSON})
    const actionPattern2 = /\bAction:\s*([a-zA-Z0-9_]+)\s*\r?\n\s*Action Input:\s*/i;
    const actionMatch2 = actionPattern2.exec(text);
    if (actionMatch2) {
        const toolName2 = actionMatch2[1];
        const jsonStartIdx = actionMatch2.index + actionMatch2[0].length;
        const balanced = this.readBalancedJson(text, jsonStartIdx);
        if (balanced) {
            try {
                const args = JSON.parse(balanced.json);
                // 可选：对 Bash 工具进行参数规范化
                let normalizedArgs = args;
                if (toolName2.toLowerCase() === "bash") {
                    normalizedArgs = { command: String(args.command ?? args.cmd ?? "") };
                }
                return {
                    start: actionMatch2.index,
                    end: balanced.end,
                    toolCall: this.makeToolCall(toolName2, normalizedArgs),
                };
            } catch (e) {
                logForDebugging(`[ToolCallExtractor] 解析 Action Input JSON 失败: ${e.message}`, { level: 'debug' });
            }
        }
    }
    // 模式17: 最后的兜底 —— 仅当 JSON 对象包含明确的工具特征时才匹配
    const maybeJsonMatch = /^\s*(\{[\s\S]*?\})/.exec(text);
    if (maybeJsonMatch) {
        const start = maybeJsonMatch.index;
        const balanced = this.readBalancedJson(text, start);
        if (balanced) {
            try {
                const args = JSON.parse(balanced.json);
                // 检查是否具有明显的工具调用特征
                const hasToolField = args.name || args.tool || args.function;
                const hasTypicalToolArgs = args.command !== undefined || args.pattern !== undefined || args.code !== undefined || args.queries !== undefined;
                if (hasToolField || hasTypicalToolArgs) {
                    const inferredName = this.inferToolNameFromArgs(args);
                    if (inferredName) {
                        return { start, end: balanced.end, toolCall: this.makeToolCall(inferredName, args) };
                    }
                }
            } catch {} 
        }
    } 
		// 增强：支持 <tool_calling> 内嵌 <tool_call name="..."> 或 <tool_call> 子元素
		const toolCallingTagEnhanced = /<tool_calling>([\s\S]*?)<\/tool_calling>/i.exec(text);
		if (toolCallingTagEnhanced) {
			const inner = toolCallingTagEnhanced[1];
			let toolName: string | null = null;
			let args: any = {};

			// 尝试 <name> 标签
			const nameMatch = /<name>([^<]*)<\/name>/i.exec(inner);
			if (nameMatch) toolName = nameMatch[1].trim();

			// 尝试 <arguments> 标签（可能包含 JSON）
			const argsMatch = /<arguments>([\s\S]*?)<\/arguments>/i.exec(inner);
			if (argsMatch) {
				try { args = JSON.parse(argsMatch[1].trim()); } catch { args = {}; }
			}

			// 如果上面的都失败，尝试从 <tool_call name="..."> 属性提取
			if (!toolName) {
				const tcAttr = /<tool_call\s+name\s*=\s*["']([^"']+)["']/i.exec(inner);
				if (tcAttr) toolName = tcAttr[1].trim();
			}

			// 如果还没有参数，尝试 inner 中第一个 JSON 对象作为参数
			if (Object.keys(args).length === 0) {
				const jsonMatch = inner.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					try { args = JSON.parse(jsonMatch[0]); } catch { args = {}; }
				}
			}

			if (toolName) {
				return {
					start: toolCallingTagEnhanced.index,
					end: toolCallingTagEnhanced.index + toolCallingTagEnhanced[0].length,
					toolCall: this.makeToolCall(toolName, args),
				};
			}
		}
    return null;
  }

  // ========== 主入口 extract：保留原有逻辑并增加安全截断 ==========
  public extract(delta: string): ExtractResult {
    this.buffer += delta;
    const newToolCalls: ToolCall[] = [];

    // 循环提取已知的完整工具调用
    while (true) {
      const match = this.findToolCall();
      if (!match) break;
      const addedCalls = this.addOrMergeToolCall(match.toolCall);
      newToolCalls.push(...addedCalls);
      this.buffer = this.buffer.slice(0, match.start) + this.buffer.slice(match.end);
      if (this.emittedTextLen > match.start) {
        this.emittedTextLen = Math.min(this.emittedTextLen, this.buffer.length);
      }
    }

    // 查找可能的不完整工具调用前缀，这些前缀之前的内容可以安全输出
    let safeEnd = this.buffer.length;
    const searchFrom = this.emittedTextLen;
    // 只保留真正需要延迟的关键词（避免误判，如普通文本中的 "<" 可能属于 HTML）
    const suspiciousPrefixes = [
      '<tool_calling',
      '<tool_call',
      'Tool:',
      'Action:',
    ];
    for (const prefix of suspiciousPrefixes) {
      const idx = this.buffer.indexOf(prefix, searchFrom);
      if (idx !== -1 && idx < safeEnd) {
        safeEnd = idx;
      }
    }

    // 对于 XML 风格，还要检查 <name> 等内部标签，进一步截断
    let extraSafeEnd = safeEnd;
    const xmlOpen = this.buffer.indexOf('<', searchFrom);
    if (xmlOpen !== -1 && xmlOpen < extraSafeEnd) {
      extraSafeEnd = xmlOpen;
    }
    safeEnd = Math.min(safeEnd, extraSafeEnd);

    const newText = this.buffer.slice(this.emittedTextLen, safeEnd);
    this.emittedTextLen = safeEnd;

    return {
      text: newText,
      toolCalls: newToolCalls,
      remaining: this.buffer.slice(safeEnd),
    };
  }

  /**
   * flush 方法：强制结束，提取剩余内容
   */
  public flush(): ExtractResult {
    // 最后一次尝试提取所有可能的工具调用
    const finalToolCalls: ToolCall[] = [];
    let remaining = this.buffer;
    let modified = false;

    while (true) {
      const savedBuffer = this.buffer;
      this.buffer = remaining;
      const match = this.findToolCall();
      this.buffer = savedBuffer;
      if (!match) break;
      const addedCalls = this.addOrMergeToolCall(match.toolCall);
      finalToolCalls.push(...addedCalls);
      remaining = remaining.slice(0, match.start) + remaining.slice(match.end);
      modified = true;
    }

    if (modified) {
      this.buffer = remaining;
      this.emittedTextLen = Math.min(this.emittedTextLen, this.buffer.length);
    }

    // 所有未能匹配的内容作为普通文本输出（不再尝试提取工具调用）
    const finalText = this.buffer;
    // 清空所有状态
    this.buffer = "";
    this.emittedTextLen = 0;
    this.toolCallCounter = 0;
    this.seenToolKeys.clear();
    this.pendingToolCalls.clear();
    this.emittedToolKeys.clear();

    return { text: finalText, toolCalls: finalToolCalls, remaining: "" };
  }

  public reset(): void {
    this.inSentinel = false;
    this.sentinelBuffer = "";
    this.toolCallCounter = 0;
    this.pendingToolCalls.clear();
    this.emittedToolKeys.clear();
    this.emittedText = "";
  }
}