import { APIError } from '@anthropic-ai/sdk'

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


type OpenAICompatConfig = {
  apiKey: string
  baseURL: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}


type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}


type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
}


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
 * �?Anthropic 的消息内容（可能是字符串或内容块数组）转换为纯文�?
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
 * 确保 content 以内容块数组的形式返回（若为字符串则包装�?text 块）
 */
function toBlocks(content: BetaMessageParam['content']): AnyBlock[] {
  return Array.isArray(content)
    ? (content as unknown as AnyBlock[])
    : [{ type: 'text', text: content }]
}

/**
 * �?Anthropic 工具定义转换�?OpenAI 工具定义格式
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
 * �?Anthropic 格式的请求转换为 OpenAI 兼容的请求体
 * 会处�?system prompt、多模态内容、工具调用等字段的映�?
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
  logForDebugging('[openaiCompat] 开始将 Anthropic 请求转换�?OpenAI 格式', { level: 'debug' })
  
  const configuredModel = process.env.ANTHROPIC_MODEL?.trim()
  const targetModel = configuredModel || input.model
  logForDebugging(`[openaiCompat] 目标模型: ${targetModel} (原始: ${input.model}, 环境覆盖: ${configuredModel ?? '�?})`, { level: 'debug' })
  const messages: OpenAIChatMessage[] = []

  
  if (input.system) {
    const systemText = Array.isArray(input.system)
      ? input.system.map(block => block.text ?? '').join('\n')
      : input.system
    if (systemText) {
      messages.push({ role: 'system', content: systemText })
      logForDebugging(`[openaiCompat] 添加 system 消息 (长度: ${systemText.length})`, { level: 'debug' })
    }
  }

  
  for (const message of input.messages) {
    logForDebugging(`[openaiCompat] 处理消息 role=${message.role}`, { level: 'debug' })
    if (message.role === 'user') {
      const blocks = toBlocks(message.content)
      
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
  logForDebugging(`[openaiCompat] 转换完成: 模型: ${targetModel}，总消息数=${messages.length}, 工具�?${result.tools?.length ?? 0}`, { level: 'debug' })
  return result
}

/**
 * �?OpenAI 兼容端点发起流式 POST 请求，返回可读流读取�?
 * 内置了错误处理，�?429/529/5xx 抛出 APIError，以便上游进行重�?
 */
export async function createOpenAICompatStream(
  config: { apiKey: string; baseURL: string; headers?: Record<string, string>; fetch?: typeof fetch },
  request: any,
  signal: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const baseURL = config.baseURL.replace(/\/+$/, '')
  const url = `${baseURL}/v1/chat/completions`
  logForDebugging('[openaiCompat] 准备请求 URL: ' + url, { level: 'debug' })
  logForDebugging(`[openaiCompat] 请求�? ${JSON.stringify({ ...request, stream: true })}`, { level: 'debug' })
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
      `OpenAI compat request failed with status ${response.status}${responseText ? ': ' + responseText : ''}. 请确认服务端返回的是有效�?OpenAI 格式响应。`,
    )
  }

  logForDebugging(`[openaiCompat] 请求成功, 状态码=${response.status}, 准备读取流`, { level: 'debug' })
  return response.body.getReader()
}

/**
 * 解析 SSE 流缓冲区，返回完整的事件数组和未完成的部�?
 * 按双换行分隔，最后一个不完整的块存入 remainder
 */
function parseSSEChunk(buffer: string): { events: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  return { events: parts, remainder }
}

/**
 * �?OpenAI �?finish_reason 映射�?Anthropic �?stop_reason
 */
function mapFinishReason(reason: string | null | undefined): BetaMessage['stop_reason'] {
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}
/**
 * �?OpenAI 兼容的流式响应转换为 Anthropic �?Stream 事件（BetaRawMessageStreamEvent�?
 * 该异步生成器会不�?yield 事件，直到流结束并返回最终的 BetaMessage
 *
 * 处理逻辑�?
 * 1. 如果 chunk 中包�?choices 字段，则�?OpenAI 格式解析 delta
 * 2. 如果没有 choices，视为原�?Anthropic 事件路径（已包含完整�?BetaRawMessageStreamEvent 字段�?
 * 3. 自动合成缺失�?content_block_start / content_block_stop / message_delta
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
      logForDebugging(`[openaiCompat] 关闭原生�?index=${idx}`, { level: 'debug' })
      yield { type: 'content_block_stop', index: idx } as BetaRawMessageStreamEvent
    }
    nativeBlockType.clear()
    nativeIdxMap.clear()
  }
 
  function createAssistantMessageFromToolCalls(): AssistantMessage | null {
    if (collectedToolCalls.length === 0) return null;
    logForDebugging(`[openaiCompat] 产出 AssistantMessage，包�?${collectedToolCalls.length} 个工具调用`, { level: 'debug' });
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
      logForDebugging(`[openaiCompat] 流读取完�? 总响应字节数=${responseBytes}`, { level: 'debug' })
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
            logForDebugging('[openaiCompat] 收到 [DONE] 事件，开始收�?, { level: 'debug' })
            
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
            
            await closeActiveBlock()
            for (const ai of toolIdxMap.values()) {
              logForDebugging(`[openaiCompat] 关闭工具�?index=${ai}`, { level: 'debug' })
              yield { type: 'content_block_stop', index: ai } as BetaRawMessageStreamEvent
            }
            if (!nativeMessageDeltaSent && started) {
              logForDebugging('[openaiCompat] 发�?message_delta (end_turn)', { level: 'debug' })
              yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: completionTokens } } as BetaRawMessageStreamEvent
            }
            
            yield { type: 'message_stop' } as BetaRawMessageStreamEvent
            _lastResponseBytes = responseBytes
            logForDebugging(`[openaiCompat] 流结�? 最�?token 用量: input=${promptTokens}, output=${completionTokens}, 字节=${responseBytes}`, { level: 'debug' })

            
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
										
								}
						}
						
						 
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
                logForDebugging(`[openaiCompat] 原生 tool_use 开�? index=${anthropicIdx}, name=${block.name}, id=${block.id}`, { level: 'debug' })
                yield { type: 'content_block_start', index: anthropicIdx, content_block: block }
              } else {
                nativeBlockType.set(anthropicIdx, 'text')
                logForDebugging(`[openaiCompat] 原生文本块开�? index=${anthropicIdx}`, { level: 'debug' })
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
                logForDebugging(`[openaiCompat] 转换 thinking_delta �?text_delta, 文本长度=${String(delta.thinking).length}`, { level: 'debug' })
              }
              if (anthropicIdx === undefined) {
                anthropicIdx = nextContentIndex++
                nativeIdxMap.set(upstreamIdx, anthropicIdx)
                const guessType = originalType === 'input_json_delta' ? 'tool_use' : 'text'
                nativeBlockType.set(anthropicIdx, guessType)
                logForDebugging(`[openaiCompat] 自动合成 ${guessType} �?(upstream ${upstreamIdx} -> Anthropic ${anthropicIdx})`, { level: 'debug' })
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
              
              _lastResponseBytes = responseBytes
              yield { type: 'message_stop' }

              
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
											
									}
							}
							
							 
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

        
        
        
        const chunk = event as unknown as OpenAIStreamChunk
        const choice = chunk.choices[0]
        const delta = choice ? (choice.delta as Record<string, unknown>) : void 0

        if (!started) {
          started = true
          promptTokens = chunk.usage?.prompt_tokens ?? 0
          yield { type: 'message_start', message: { id: chunk.id ?? 'openai-compat', type: 'message', role: 'assistant', model: input.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: promptTokens, output_tokens: 0 } } }
        }

        
        if (delta?.content) {
          const text = delta.content as string
          const result = toolExtractor.extract(text)   
          
          for (const tc of result.toolCalls) {
            collectedToolCalls.push(tc)
          }
          
          if (result.text) {
            collectedText += result.text
            if (activeBlockType !== 'text') {
              yield* closeActiveBlock()
              activeBlockIndex = nextContentIndex++
              yield { type: 'content_block_start', index: activeBlockIndex, content_block: { type: 'text', text: '' } }
              activeBlockType = 'text'
            }
            yield { type: 'content_block_delta', index: activeBlockIndex, delta: { type: 'text_delta', text: result.text } }
          }
          
          for (const toolCall of result.toolCalls) {
            yield* closeActiveBlock()   
            const idx = nextContentIndex++
            let input: any
            try { input = JSON.parse(toolCall.function.arguments) } catch { input = {} }
            yield { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: toolCall.id, name: toolCall.function.name, input: '' } }
            yield { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: toolCall.function.arguments } }
            yield { type: 'content_block_stop', index: idx }
          }
        }

        
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

        
 
          logForDebugging(`[openaiCompat] 收到 finish_reason=${choice.finish_reason}, 准备结束消息`, { level: 'debug' })
          
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
          
          yield { type: 'message_delta', delta: { stop_reason: mapFinishReason(choice.finish_reason), stop_sequence: null }, usage: { output_tokens: completionTokens } }
          yield { type: 'message_stop' }

          
          const finalContent: any[] = []
          if (collectedText) finalContent.push({ type: 'text', text: collectedText })
          for (const tc of collectedToolCalls) {
            let inputObj: any
            try { inputObj = JSON.parse(tc.function.arguments) } catch { inputObj = {} }
            finalContent.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: inputObj })
          }
					
					 
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
  
  _lastResponseBytes = responseBytes
  if (!started) throw new Error(`[openaiCompat] 未收�?message_start 事件，模�? ${input.model}`)
  
  
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


let _lastResponseBytes = 0
export function getLastResponseBytes(): number {
  return _lastResponseBytes
}

/**
 * �?OpenAI �?usage 信息映射�?Anthropic �?BetaUsage 结构
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

/**
 * 全功能工具调用提取器
 * 支持多种格式：XML标签、代码块、函数调用、JSON对象�?
 * 当无法匹配任何已知模式且缓冲区非空时，会回退将全部文本作为特殊工具调用提�?
 */
export class ToolCallExtractor {
  private buffer = "";
  private emittedTextLen = 0;
  private toolCallCounter = 0;
  private seenToolKeys = new Set<string>();

  constructor(private opts: { enableBashCodeBlock?: boolean } = {}) {}

  private generateId(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  /**
   * 将原始工具名规范化为系统期望的名称（首字母大写，去除命名空间前缀�?
   */
  private normalizeToolName(name: string): string {
    const base = name.includes(':') ? name.split(':').pop() || name : name;
    const mapping: Record<string, string> = {
        "bash": "bash",
        "cmd": "bash",
        "shell": "bash",
        "powershell": "bash",
        "batch": "bash",
        "glob": "glob",
        "read": "read",
        "grep": "grep",
        "write": "write",
        "edit": "edit",
        "listfiles": "listfiles",
        "web_search": "web_search",
        "code_interpreter": "code_interpreter",
        "web_extractor": "web_extractor",
        "str_replace_editor": "str_replace_editor",
    };
    const lower = base.toLowerCase();
    if (mapping[lower]) return mapping[lower];
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  private makeToolCall(name: string, args: unknown): ToolCall {
    const normalizedName = this.normalizeToolName(name);
    let finalArgs = args;
    if (normalizedName === "bash" && typeof finalArgs === "object" && finalArgs !== null) {
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
    logForDebugging(`[ToolCallExtractor] 组装工具调用: ${JSON.stringify(toolCall)}`, { level: 'debug' });
    return toolCall;
  }

  private inferToolNameFromArgs(args: any): string | null {
    if (!args || typeof args !== "object") return null;
    
    if (args.tool && typeof args.tool === "string") return args.tool;
    if (args.name && typeof args.name === "string") return args.name;
    
    if (args.command !== undefined || args.cmd !== undefined) return "bash";
    if (args.code !== undefined) return "code_interpreter";
    if (args.queries !== undefined || args.query !== undefined) return "web_search";
    if (args.url !== undefined || args.urls !== undefined) return "web_extractor";
    if (args.file_path !== undefined || args.filePath !== undefined) return "read";
    if (args.pattern !== undefined) {
      if (args.path === undefined || args.path === "") return "glob";
      return "grep";
    }
    return null;
  }

  private normalizeToolCall(parsed: any): ToolCall | null {
    if (!parsed || typeof parsed !== "object") return null;
    
    
    const extractArgs = (obj: any, excludeKey: string): any => {
      
      const argsField = obj.arguments ?? obj.parameters ?? obj.params;
      if (argsField && typeof argsField === "object") {
        return argsField;
      }
      
      const { [excludeKey]: _, ...rest } = obj;
      return rest;
    };
    
    if (parsed.name && typeof parsed.name === "string") {
      const args = extractArgs(parsed, "name");
      return this.makeToolCall(parsed.name, args);
    }
    
    if (parsed.tool && typeof parsed.tool === "string") {
      const args = extractArgs(parsed, "tool");
      return this.makeToolCall(parsed.tool, args);
    }
    
    if (parsed.function && typeof parsed.function === "string") {
      const args = extractArgs(parsed, "function");
      return this.makeToolCall(parsed.function, args);
    }
    
    const inferredName = this.inferToolNameFromArgs(parsed);
    if (inferredName) {
      return this.makeToolCall(inferredName, parsed);
    }
    return null;
  }

  private readBalancedJson(text: string, start: number): { json: string; end: number } | null {
    logForDebugging(`[ToolCallExtractor] readBalancedJson 调用: start=${start}, text�?0字符: ${text.slice(start, start+50)}`, { level: 'debug' });
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) return null;
    const open = text[i];
    if (open !== '{' && open !== '[') return null;
    const close = open === '{' ? '}' : ']';
    let stack = 0;
    let inString = false;
    let escape = false;
    let result: { json: string; end: number } | null = null;
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
        else if (ch === close) { stack--; if (stack === 0) { result = { json: text.slice(i, pos + 1), end: pos + 1 }; break; } }
    }
    if (result) return result;
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
    
    
    const jsonToolPattern = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/i;
    let toolNameMatch = jsonToolPattern.exec(text);
    if (!toolNameMatch) {
      
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
      
      const balancedArgs = this.readBalancedJson(argsStr, 0);
      if (balancedArgs) {
        try {
          const args = JSON.parse(balancedArgs.json);
          logForDebugging(`[ToolCallExtractor] 匹配到工�?JSON: ${toolName}`, { level: 'debug' });
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
    
    const jsonToolWithToolField = /\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/i;
    let toolMatch = jsonToolWithToolField.exec(text);
    if (!toolMatch) {
      
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
          logForDebugging(`[ToolCallExtractor] 匹配到工�?JSON (tool字段): ${toolName}`, { level: 'debug' });
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
    
    const backtickBlock = this.detectBacktickCodeBlock();
    if (backtickBlock) {
      const { language, content, start, end } = backtickBlock;
      if (["cmd", "bash", "shell", "sh", "powershell", "batch", "ps1"].includes(language)) {
        const command = content.trim();
        if (command) {
          return { start, end, toolCall: this.makeToolCall("bash", { command }) };
        }
      }
    }
    
    const commandPrefixPattern = /^\s*(?:findstr|cd|dir|git|grep|ls|pwd|echo|cat|head|tail|wc|sort|uniq|awk|sed|tar|zip|unzip|chmod|chown|ps|kill|rm|cp|mv|mkdir|rmdir|touch|which|where|type)\s+([^\n]*)/im;
    const cmdMatch = commandPrefixPattern.exec(text);
    if (cmdMatch) {
      const command = cmdMatch[0].trim();
      
      return {
        start: cmdMatch.index,
        end: cmdMatch.index + command.length,
        toolCall: this.makeToolCall("bash", { command }),
      };
    }
    
    const toolCallAttr = /<tool_call\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/i.exec(text);
    if (toolCallAttr) {
      const toolName = toolCallAttr[1];
      const inner = toolCallAttr[2].trim();
      let args: any;
      try {
        
        args = JSON.parse(inner);
      } catch {
        
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
  
    
    const jsonObjectMatch = /^\s*(\{[\s\S]*?\})\s*([\s\S]*)$/m.exec(text);
    if (jsonObjectMatch) {
      const jsonStr = jsonObjectMatch[1];
      const afterJson = jsonObjectMatch[2];
      
      const balanced = this.readBalancedJson(text, text.indexOf(jsonStr));
      if (balanced && balanced.json === jsonStr) {
        try {
          const args = JSON.parse(jsonStr);
          
          const inferredName = this.inferToolNameFromArgs(args);
          if (inferredName) {
            
            
            return {
              start: 0,
              end: balanced.end,
              toolCall: this.makeToolCall(inferredName, args),
            };
          }
        } catch {}
      }
    }
    
    const bashXml = /<bash>\s*\n?([\s\S]*?)\n?\s*<\/bash>/i.exec(text);
    if (bashXml) {
      const inner = bashXml[1];
      
      const commandMatch = /<command>([\s\S]*?)<\/command>/i.exec(inner);
      let command = commandMatch ? commandMatch[1].trim() : inner.trim();
      const descMatch = /<description>([\s\S]*?)<\/description>/i.exec(inner);
      const args: any = { command };
      if (descMatch) args.description = descMatch[1].trim();
      if (command) {
        return {
          start: bashXml.index,
          end: bashXml.index + bashXml[0].length,
          toolCall: this.makeToolCall("bash", args),
        };
      }
    }
    
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
          
          return {
            start: toolCallingTag.index,
            end: toolCallingTag.index + toolCallingTag[0].length,
            toolCall: this.makeToolCall(toolName, { raw: argsStr }),
          };
        }
      }
    }
    
    const toolArgsPrefix = /\bTool:\s*([a-zA-Z0-9_:]+)\s*\nArguments:\s*/i;
    const prefixMatch = toolArgsPrefix.exec(text);
    if (prefixMatch) {
      const toolName = prefixMatch[1];
      const jsonStartIdx = prefixMatch.index + prefixMatch[0].length;
      logForDebugging(`[ToolCallExtractor] 匹配�?Tool: 模式, toolName=${toolName}, jsonStartIdx=${jsonStartIdx}`, { level: 'debug' });
      
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
          try {
            const args = JSON.parse(jsonCandidate);
            logForDebugging(`[ToolCallExtractor] 成功解析 JSON: ${JSON.stringify(args).slice(0, 200)}`, { level: 'debug' });
            let finalToolName = toolName;
            const lowerName = toolName.toLowerCase();
            const knownTools = ["bash","glob","read","grep","write","edit","listfiles","web_search","code_interpreter","web_extractor","str_replace_editor"];
            if (!knownTools.includes(lowerName)) {
              const inferred = this.inferToolNameFromArgs(args);
              if (inferred) finalToolName = inferred;
              logForDebugging(`[ToolCallExtractor] 推断工具�? ${toolName} -> ${finalToolName}`, { level: 'debug' });
            }
            return {
              start: prefixMatch.index,
              end: jsonStartIdx + firstBrace + endIdx,
              toolCall: this.makeToolCall(finalToolName, args),
            };
          } catch (e) {
            logForDebugging(`[ToolCallExtractor] JSON 解析失败: ${e.message}, 候选文�? ${jsonCandidate.slice(0, 200)}`, { level: 'debug' });
          }
        } else {
          logForDebugging(`[ToolCallExtractor] 未找到完整的 JSON 对象，jsonText �?00字符: ${jsonText.slice(0, 200)}`, { level: 'debug' });
        }
      } else {
        logForDebugging(`[ToolCallExtractor] �?Arguments 后面未找�?'{' 字符，jsonText �?00字符: ${jsonText.slice(0, 200)}`, { level: 'debug' });
      }
    }
    
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
              args = { command: String(raw.command ?? raw.cmd ?? "") };
              break;
            case "web_search":
              args = { queries: Array.isArray(raw.queries) ? raw.queries.map(String) : raw.query ? [String(raw.query)] : [] };
              break;
            case "code_interpreter":
              args = { code: String(raw.code ?? ""), description: String(raw.description ?? "") };
              break;
            case "web_extractor":
              args = { urls: Array.isArray(raw.urls) ? raw.urls.map(String) : [], goal: String(raw.goal ?? "") };
              break;
          }
          return { start: calling.index, end: balanced.end, toolCall: this.makeToolCall(toolName, args) };
        } catch {}
      }
    }
    
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
    
    const functionCallsRegex = /<function_calls>([\s\S]*?)<\/function_calls>/gi;
    let fcMatch;
    while ((fcMatch = functionCallsRegex.exec(text)) !== null) {
      const fullMatch = fcMatch[0];
      const inner = fcMatch[1];
      
      const functionCallRegex = /<function_call\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/function_call>/gi;
      let innerMatch;
      while ((innerMatch = functionCallRegex.exec(inner)) !== null) {
        const toolName = innerMatch[1];
        const fcInner = innerMatch[2];
        
        const paramRegex = /<parameter\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
        const args: Record<string, any> = {};
        let paramMatch;
        while ((paramMatch = paramRegex.exec(fcInner)) !== null) {
          const paramName = paramMatch[1];
          let paramValue = paramMatch[2].trim();
          
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
      
      try {
        const parsed = JSON.parse(inner.trim());
        const tc = this.normalizeToolCall(Array.isArray(parsed) ? parsed[0] : parsed);
        if (tc) {
          return { start: fcMatch.index, end: fcMatch.index + fullMatch.length, toolCall: tc };
        }
      } catch {}
    }
    
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
    
    if (this.opts.enableBashCodeBlock) {
      const bashBlock = /```(?:bash|batch|shell|sh|cmd|powershell)\s*\r?\n([\s\S]*?)\r?\n```/i.exec(text);
      if (bashBlock) {
        const command = bashBlock[1].trim();
        if (command && command.split(/[\r\n]+/).length <= 2 && !/(?:#[^!]|&&|\|\||>>?|<\(|echo\s+["']|printf\s+["']|--help)/i.test(command)) {
          return { start: bashBlock.index, end: bashBlock.index + bashBlock[0].length, toolCall: this.makeToolCall("bash", { command }) };
        }
      }
    }
    
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
    
    const actionPattern2 = /\bAction:\s*([a-zA-Z0-9_]+)\s*\r?\n\s*Action Input:\s*/i;
    const actionMatch2 = actionPattern2.exec(text);
    if (actionMatch2) {
        const toolName2 = actionMatch2[1];
        const jsonStartIdx = actionMatch2.index + actionMatch2[0].length;
        const balanced = this.readBalancedJson(text, jsonStartIdx);
        if (balanced) {
            try {
                const args = JSON.parse(balanced.json);
                
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
    
    const maybeJsonMatch = /^\s*(\{[\s\S]*?\})/.exec(text);
    if (maybeJsonMatch) {
        const start = maybeJsonMatch.index;
        const balanced = this.readBalancedJson(text, start);
        if (balanced) {
            try {
                const args = JSON.parse(balanced.json);
                
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
    return null;
  }

  extract(delta: string): ExtractResult {
    this.buffer += delta;
    const found: ToolCall[] = [];
    while (true) {
      const match = this.findToolCall();
      if (!match) break;
      const key = `${match.toolCall.function.name}:${match.toolCall.function.arguments}`;
      if (!this.seenToolKeys.has(key)) {
        this.seenToolKeys.add(key);
        found.push(match.toolCall);
        logForDebugging(`[ToolCallExtractor] 提取工具调用成功: name=${match.toolCall.function.name}, arguments=${match.toolCall.function.arguments}`, { level: 'debug' });
      } else {
        logForDebugging(`[ToolCallExtractor] 跳过重复工具调用: ${key}`, { level: 'debug' });
      }
      this.buffer = this.buffer.slice(0, match.start) + this.buffer.slice(match.end);
      if (this.emittedTextLen > match.start) {
        this.emittedTextLen = Math.min(this.emittedTextLen, this.buffer.length);
      }
    }
    
    const newText = this.buffer.slice(this.emittedTextLen);
    this.emittedTextLen = this.buffer.length;
    return { text: newText, toolCalls: found, remaining: this.buffer };
  }
  
  private hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; 
    }
    return Math.abs(hash).toString(16);
  }
  flush(): ExtractResult {
    
    const toolCalls: ToolCall[] = [];
    let remaining = this.buffer;
    let modified = false;
    while (true) {
        
        const savedBuffer = this.buffer;
        this.buffer = remaining;
        const match = this.findToolCall();
        this.buffer = savedBuffer;
        if (!match) break;
        toolCalls.push(match.toolCall);
        remaining = remaining.slice(0, match.start) + remaining.slice(match.end);
        modified = true;
    }
    if (modified) {
        this.buffer = remaining;
        this.emittedTextLen = Math.min(this.emittedTextLen, this.buffer.length);
    }
    
    const finalText = this.buffer;
    this.buffer = "";
    this.emittedTextLen = 0;
    return { text: finalText, toolCalls, remaining: "" };
  }

  reset(): void {
    this.buffer = "";
    this.emittedTextLen = 0;
    this.toolCallCounter = 0;
    this.seenToolKeys.clear();
  }
}
