/**
 * OpenAI 兼容的 LLM 客户端。
 *
 * 这里刻意不用 SDK，直接用 fetch 说协议：读懂了这一段，就理解了绝大多数
 * agent 框架底下真正发生的事——一次 POST，返回若干条 SSE 分片，
 * 分片里累积 content 和 tool_calls。
 *
 * 兼容性：DeepSeek、Moonshot、通义、OpenAI、Ollama（/v1）都遵循同一套
 * Chat Completions 形状，所以只需要换 baseURL 和 model。
 */

import type { ChatMessage, ToolCall } from './messages.js';
import type { ToolSchema } from '../tools/types.js';

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  /** 默认 true；false 时一次性拿到完整响应 */
  stream?: boolean;
  signal?: AbortSignal;
  /** 每收到一段文本增量回调一次，用于终端实时输出 */
  onDelta?: (text: string) => void;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult {
  /** 一定是 assistant 消息，可能只包含 tool_calls */
  message: ChatMessage;
  finishReason: string | null;
  usage: Usage | null;
}

export interface LLMClient {
  chat(request: ChatRequest): Promise<ChatResult>;
}

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class OpenAICompatibleClient implements LLMClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const stream = request.stream ?? true;
    const body: Record<string, unknown> = {
      model: this.options.model,
      messages: request.messages,
      stream,
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = 'auto';
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const signal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw this.describeFetchError(error);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new LLMError(`模型接口返回 ${response.status} ${response.statusText}`, response.status, detail.slice(0, 2000));
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (stream && contentType.includes('text/event-stream') && response.body) {
      return this.readStream(response.body, request.onDelta);
    }

    // 服务端忽略 stream 参数时，按普通 JSON 响应处理
    return this.readJson(response);
  }

  private async readJson(response: Response): Promise<ChatResult> {
    const payload = (await response.json()) as CompletionResponse;
    if (payload.error) throw new LLMError(payload.error.message ?? '模型接口返回错误');

    const choice = payload.choices?.[0];
    if (!choice?.message) throw new LLMError('模型响应缺少 choices[0].message');

    return {
      message: {
        role: 'assistant',
        content: choice.message.content ?? null,
        tool_calls: choice.message.tool_calls?.length ? choice.message.tool_calls : undefined,
      },
      finishReason: choice.finish_reason ?? null,
      usage: toUsage(payload.usage),
    };
  }

  private async readStream(stream: ReadableStream<Uint8Array>, onDelta?: (text: string) => void): Promise<ChatResult> {
    let content = '';
    const calls = new Map<number, ToolCall>();
    let finishReason: string | null = null;
    let usage: Usage | null = null;

    for await (const data of sseEvents(stream)) {
      if (data === '[DONE]') break;

      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(data) as StreamChunk;
      } catch {
        continue; // 心跳或非 JSON 分片，忽略
      }
      if (chunk.error) throw new LLMError(chunk.error.message ?? '模型流式响应返回错误');

      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        content += choice.delta.content;
        onDelta?.(choice.delta.content);
      }

      // 工具调用的名字和参数都是跨分片增量拼接的，按 index 归位
      for (const delta of choice?.delta?.tool_calls ?? []) {
        const index = delta.index ?? 0;
        let slot = calls.get(index);
        if (!slot) {
          slot = { id: '', type: 'function', function: { name: '', arguments: '' } };
          calls.set(index, slot);
        }
        if (delta.id) slot.id = delta.id;
        if (delta.function?.name) slot.function.name += delta.function.name;
        if (delta.function?.arguments) slot.function.arguments += delta.function.arguments;
      }

      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) usage = toUsage(chunk.usage);
    }

    const toolCalls = [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => call)
      .filter((call) => call.function.name !== '');
    for (const call of toolCalls) {
      if (!call.id) call.id = `call_${Math.random().toString(36).slice(2, 10)}`;
    }

    return {
      message: {
        role: 'assistant',
        content: content === '' ? null : content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finishReason,
      usage,
    };
  }

  private describeFetchError(error: unknown): LLMError {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      if (error.name === 'TimeoutError') return new LLMError(`模型请求超时（${this.timeoutMs}ms）`);
      return new LLMError('模型请求被取消');
    }
    const message = error instanceof Error ? error.message : String(error);
    return new LLMError(`无法连接模型接口 ${this.endpoint}：${message}`);
  }
}

/** 把 SSE 字节流切成一条条 data 负载，处理跨网络分包的半行情况。 */
async function* sseEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replaceAll('\r', '');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = extractData(block);
        if (payload !== null) yield payload;
        boundary = buffer.indexOf('\n\n');
      }
    }

    const tail = extractData(buffer);
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function extractData(block: string): string | null {
  const lines = block.split('\n').filter((line) => line.startsWith('data:'));
  if (lines.length === 0) return null;
  return lines.map((line) => line.slice(5).trimStart()).join('\n');
}

function toUsage(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): Usage | null {
  if (!usage) return null;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
  };
}

interface CompletionResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: ToolCall[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}
