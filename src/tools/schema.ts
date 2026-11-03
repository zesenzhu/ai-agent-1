/**
 * 极简 JSON Schema 校验器。
 *
 * 只实现本示例用到的子集，目的是让「模型给的参数」在进入工具前被拦一道，
 * 而不是等工具内部抛 TypeError。生产项目可以直接换成 zod / ajv。
 */

import type { JsonSchema } from './types.js';

/** 返回错误列表，空数组表示校验通过。 */
export function validateArgs(schema: JsonSchema, value: unknown, path = 'arguments'): string[] {
  const errors: string[] = [];
  walk(schema, value, path, errors);
  return errors;
}

function walk(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    errors.push(`${path} 只能是 ${schema.enum.map(String).join(' / ')}`);
    return;
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} 不能小于 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} 不能大于 ${schema.maximum}`);
  }

  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${path} 应为对象`);
        return;
      }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in record)) errors.push(`${path}.${key} 缺失`);
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (key in record) walk(child, record[key], `${path}.${key}`, errors);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path} 应为数组`);
        return;
      }
      const items = schema.items;
      if (items) value.forEach((item, index) => walk(items, item, `${path}[${index}]`, errors));
      return;
    }
    case 'string':
      if (typeof value !== 'string') errors.push(`${path} 应为字符串`);
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path} 应为有限数字`);
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) errors.push(`${path} 应为整数`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path} 应为布尔值`);
      return;
  }
}
