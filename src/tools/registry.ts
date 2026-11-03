/**
 * 工具注册表：统一负责「给模型看声明」和「按名字执行」。
 *
 * 关键约定：execute 永不抛异常。任何失败都转成 ok=false 的结果文本，
 * 由模型决定重试或换一种做法，否则一次参数错误就会中断整轮对话。
 */

import { validateArgs } from './schema.js';
import type { Tool, ToolContext, ToolResult, ToolSchema } from './types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具重名：${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: readonly Tool[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** 传给模型的工具声明列表 */
  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  async execute(name: string, rawArguments: string, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        name,
        content: `未知工具「${name}」。可用工具：${this.names().join('、') || '无'}`,
      };
    }

    let args: unknown;
    try {
      args = rawArguments.trim() === '' ? {} : JSON.parse(rawArguments);
    } catch {
      return { ok: false, name, content: `参数不是合法 JSON：${truncate(rawArguments, 300)}` };
    }

    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return { ok: false, name, content: '参数必须是 JSON 对象' };
    }

    const errors = validateArgs(tool.parameters, args);
    if (errors.length > 0) {
      return { ok: false, name, content: `参数校验失败：${errors.join('；')}` };
    }

    try {
      const content = await tool.run(args as Record<string, unknown>, context);
      return { ok: true, name, content };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, name, content: `工具执行失败：${message}` };
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
