/**
 * Agent 核心：一个「调用模型 → 执行工具 → 把结果回填 → 再调用模型」的循环。
 *
 * 这个循环就是所有 agent 框架的骨架，剩下的都是围绕它加能力：
 * 记忆、检索、多 agent、审批、可观测性。
 */

import type { ChatMessage } from './messages.js';
import type { ChatRequest, ChatResult, LLMClient } from './llm.js';
import type { ToolContext } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';

export type AgentEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; content: string }
  | { type: 'final'; text: string }
  | { type: 'step_limit'; steps: number };

export interface AgentOptions {
  llm: LLMClient;
  tools: ToolRegistry;
  systemPrompt: string;
  /** 一轮用户输入内最多几次模型调用（含工具轮），默认 8 */
  maxSteps?: number;
  /** 保留的非 system 历史条数，默认 40 */
  maxHistory?: number;
  temperature?: number;
  stream?: boolean;
}

export class Agent {
  private messages: ChatMessage[];
  private readonly llm: LLMClient;
  private readonly tools: ToolRegistry;
  private readonly systemPrompt: string;
  private readonly maxSteps: number;
  private readonly maxHistory: number;
  private readonly temperature: number | undefined;
  private readonly stream: boolean;

  constructor(options: AgentOptions) {
    this.llm = options.llm;
    this.tools = options.tools;
    this.systemPrompt = options.systemPrompt;
    this.maxSteps = options.maxSteps ?? 8;
    this.maxHistory = options.maxHistory ?? 40;
    this.temperature = options.temperature;
    this.stream = options.stream ?? true;
    this.messages = [{ role: 'system', content: options.systemPrompt }];
  }

  get history(): readonly ChatMessage[] {
    return this.messages;
  }

  /** 用持久化的历史覆盖当前会话，system 消息始终使用当前配置的提示词。 */
  loadHistory(messages: readonly ChatMessage[]): void {
    this.messages = [{ role: 'system', content: this.systemPrompt }, ...messages.filter((m) => m.role !== 'system')];
    this.trimHistory();
  }

  reset(): void {
    this.messages = [{ role: 'system', content: this.systemPrompt }];
  }

  /**
   * 执行一轮用户输入。事件流用于终端实时输出；
   * 内部把「产生事件」和「推进循环」分开，避免生成器里混入回调地狱。
   */
  async *run(userInput: string, context: ToolContext): AsyncGenerator<AgentEvent> {
    const channel = new Channel<AgentEvent>();
    let failure: unknown = null;

    const driver = this.drive(userInput, context, (event) => channel.push(event))
      .catch((error: unknown) => {
        failure = error;
      })
      .finally(() => channel.close());

    for await (const event of channel) {
      yield event;
    }
    await driver;

    if (failure) throw failure;
  }

  private async drive(userInput: string, context: ToolContext, emit: (event: AgentEvent) => void): Promise<void> {
    this.messages.push({ role: 'user', content: userInput });
    this.trimHistory();

    for (let step = 1; step <= this.maxSteps; step += 1) {
      const response = await this.callModel(context, emit);
      this.messages.push(response.message);

      const toolCalls = response.message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        emit({ type: 'final', text: response.message.content ?? '' });
        this.trimHistory();
        return;
      }

      for (const call of toolCalls) {
        emit({ type: 'tool_call', id: call.id, name: call.function.name, args: call.function.arguments });
        const result = await this.tools.execute(call.function.name, call.function.arguments, context);
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: result.content,
        });
        emit({ type: 'tool_result', id: call.id, name: result.name, ok: result.ok, content: result.content });
      }

      this.trimHistory();
    }

    // 触达上限：撤掉工具再问一次，保证用户总能拿到一个结论而不是空转
    emit({ type: 'step_limit', steps: this.maxSteps });
    this.messages.push({
      role: 'user',
      content: '已达到工具调用轮数上限。请直接基于已经获得的信息给出最终答复，不要再请求调用工具。',
    });
    const forced = await this.callModel(context, emit, false);
    this.messages.push(forced.message);
    emit({ type: 'final', text: forced.message.content ?? '' });
    this.trimHistory();
  }

  private callModel(context: ToolContext, emit: (event: AgentEvent) => void, withTools = true): Promise<ChatResult> {
    const request: ChatRequest = {
      messages: [...this.messages],
      temperature: this.temperature,
      stream: this.stream,
      signal: context.signal,
      onDelta: (text) => emit({ type: 'delta', text }),
    };
    if (withTools) request.tools = this.tools.schemas();
    return this.llm.chat(request);
  }

  /**
   * 裁剪历史时必须以 user 消息开头：
   * tool 消息必须紧跟它的 assistant(tool_calls)，截断到一半会让接口报错。
   */
  private trimHistory(): void {
    const system = this.messages[0]?.role === 'system' ? this.messages[0] : undefined;
    const rest = system ? this.messages.slice(1) : this.messages;
    if (rest.length <= this.maxHistory) return;

    let start = rest.length - this.maxHistory;
    while (start < rest.length && rest[start]?.role === 'tool') start += 1;

    this.messages = system ? [system, ...rest.slice(start)] : rest.slice(start);
  }
}

/**
 * 一个最小的异步队列：把「回调里产生的事件」转成「生成器可以 await 的事件」。
 * 没有它，onDelta 的实时输出就没法穿过 await 边界。
 */
class Channel<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.buffer.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
  }

  private next(): Promise<IteratorResult<T>> {
    const value = this.buffer.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
    const { promise, resolve } = Promise.withResolvers<IteratorResult<T>>();
    this.waiters.push(resolve);
    return promise;
  }
}
