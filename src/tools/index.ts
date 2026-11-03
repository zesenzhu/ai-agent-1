/**
 * 内置工具集合。新增工具时在这里注册一行，Agent 就能看到它。
 */

import { calculate, formatNumber } from './calculator.js';
import { listDirTool, readFileTool, writeFileTool } from './fs.js';
import { httpGetTool } from './http.js';
import { getCurrentTimeTool } from './time.js';
import type { Tool } from './types.js';

export const calculateTool: Tool = {
  name: 'calculate',
  description: '计算数学表达式，支持 + - * / % ^ 和括号，返回精确到 12 位有效数字的结果。',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: '数学表达式，例如 (12+3)*4' },
    },
    required: ['expression'],
  },
  run(args) {
    const expression = String(args.expression);
    return `${expression} = ${formatNumber(calculate(expression))}`;
  },
};

export function createDefaultTools(): Tool[] {
  return [getCurrentTimeTool, calculateTool, readFileTool, writeFileTool, listDirTool, httpGetTool];
}

export { getCurrentTimeTool, httpGetTool, listDirTool, readFileTool, writeFileTool };
