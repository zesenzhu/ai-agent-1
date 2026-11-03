/**
 * 工具系统的公共类型。
 *
 * 设计要点：
 * - 工具只用 JSON Schema 描述参数，模型和校验器共用同一份定义，避免两处维护。
 * - run 的入参是已经过校验的对象，工具内部不必重复做类型判断。
 * - 工具返回字符串：它会被原样回填给模型，所以文本要面向模型书写。
 */

export type JsonSchemaType = 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';

export interface JsonSchema {
  type: JsonSchemaType;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
}

/** 传给模型的工具声明，形状遵循 OpenAI function calling。 */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

/** 工具运行环境。workspace 是文件类工具允许访问的根目录。 */
export interface ToolContext {
  workspace: string;
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  run(args: Record<string, unknown>, context: ToolContext): Promise<string> | string;
}

export interface ToolResult {
  ok: boolean;
  name: string;
  /** 回填给模型的内容；失败时是可读的错误说明，让模型有机会自我修正 */
  content: string;
}
