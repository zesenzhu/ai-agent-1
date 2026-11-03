/**
 * 文件类工具：读写与列目录，全部限制在 workspace 沙箱内。
 *
 * 沙箱判断用 realpath 之外的路径归一化：resolve 之后必须仍在根目录之下，
 * 这样 `../`、绝对路径、以及 `a/../../b` 这类写法都会被拦下。
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Tool, ToolContext } from './types.js';

const DEFAULT_READ_LIMIT = 60_000;
const MAX_ENTRIES = 200;

/** 把用户给的路径解析到沙箱内，越界直接抛错。 */
export function resolveInsideWorkspace(workspace: string, input: string): string {
  const root = resolve(workspace);
  const target = resolve(root, input || '.');
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路径越界：${input} 不在工作目录 ${root} 内`);
  }
  return target;
}

function relativeForDisplay(workspace: string, absolute: string): string {
  const rel = relative(resolve(workspace), absolute);
  return rel === '' ? '.' : rel;
}

export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取工作目录内的文本文件，返回内容和字节数。大文件会被截断。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作目录的文件路径' },
      maxChars: { type: 'integer', description: '最多返回的字符数，默认 60000', minimum: 100 },
    },
    required: ['path'],
  },
  async run(args, context) {
    const path = String(args.path);
    const maxChars = typeof args.maxChars === 'number' ? args.maxChars : DEFAULT_READ_LIMIT;
    const absolute = resolveInsideWorkspace(context.workspace, path);
    const info = await stat(absolute);
    if (info.isDirectory()) throw new Error(`${path} 是目录，请使用 list_dir`);

    const buffer = await readFile(absolute);
    const text = buffer.toString('utf8');
    const truncated = text.length > maxChars;
    return [
      `文件：${relativeForDisplay(context.workspace, absolute)}`,
      `字节数：${buffer.byteLength}`,
      truncated ? `注意：内容超过 ${maxChars} 字符，已截断` : null,
      '---',
      truncated ? text.slice(0, maxChars) : text,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  },
};

export const writeFileTool: Tool = {
  name: 'write_file',
  description: '把文本写入工作目录内的文件，目录不存在会自动创建，已存在则覆盖。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作目录的文件路径' },
      content: { type: 'string', description: '要写入的完整文本内容' },
    },
    required: ['path', 'content'],
  },
  async run(args, context) {
    const path = String(args.path);
    const content = String(args.content);
    const absolute = resolveInsideWorkspace(context.workspace, path);
    const parent = resolve(absolute, '..');
    await mkdir(parent, { recursive: true });
    await writeFile(absolute, content, 'utf8');
    return `已写入 ${relativeForDisplay(context.workspace, absolute)}，${Buffer.byteLength(content)} 字节`;
  },
};

export const listDirTool: Tool = {
  name: 'list_dir',
  description: '列出工作目录内某个目录的条目，返回类型和大小，最多 200 条。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作目录的目录路径，默认 .' },
    },
  },
  async run(args, context) {
    const path = typeof args.path === 'string' && args.path !== '' ? args.path : '.';
    const absolute = resolveInsideWorkspace(context.workspace, path);
    const entries = await readdir(absolute, { withFileTypes: true });
    const lines: string[] = [`目录：${relativeForDisplay(context.workspace, absolute)}`];

    for (const entry of entries.slice(0, MAX_ENTRIES)) {
      const entryPath = resolve(absolute, entry.name);
      const suffix = entry.isDirectory() ? '/' : await sizeSuffix(entryPath);
      lines.push(`${entry.isDirectory() ? '目录' : '文件'}  ${entry.name}${suffix}`);
    }
    if (entries.length > MAX_ENTRIES) lines.push(`…… 其余 ${entries.length - MAX_ENTRIES} 条已省略`);

    return lines.join('\n');
  },
};

async function sizeSuffix(path: string): Promise<string> {
  try {
    const info = await stat(path);
    return `  ${info.size} 字节`;
  } catch {
    return '';
  }
}
