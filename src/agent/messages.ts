/**
 * 会话消息类型，字段与 OpenAI Chat Completions 协议保持一致。
 * 这样做的好处是：换模型供应商时只需要换 baseURL，不需要改内部数据结构。
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** 模型请求调用工具时返回的结构，arguments 是 JSON 字符串而不是对象。 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: Role;
  /** assistant 只调用工具时 content 为 null */
  content: string | null;
  /** 仅 assistant 消息携带 */
  tool_calls?: ToolCall[];
  /** 仅 tool 消息携带，用于把结果回填到对应的调用上 */
  tool_call_id?: string;
  /** 仅 tool 消息携带，便于阅读和调试 */
  name?: string;
}

export function isToolCallMessage(message: ChatMessage): message is ChatMessage & { tool_calls: ToolCall[] } {
  return message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}
