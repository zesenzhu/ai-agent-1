/**
 * HTTP GET 工具：给模型一个只读的外部信息来源。
 *
 * 安全边界：
 * - 只允许 http/https，避免 file:// 之类的协议读到本机文件；
 * - 有超时和返回长度上限，防止一次调用把上下文塞满；
 * - 只做 GET，不做写操作，模型无法通过它修改外部状态。
 */

import type { Tool } from './types.js';

const DEFAULT_MAX_CHARS = 4_000;
const TIMEOUT_MS = 15_000;

export const httpGetTool: Tool = {
  name: 'http_get',
  description: '发起 HTTP GET 请求并返回响应正文（默认截断到 4000 字符），适合读取公开网页或 JSON 接口。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '完整的 http/https 地址' },
      maxChars: { type: 'integer', description: '最多返回的字符数，默认 4000', minimum: 200 },
    },
    required: ['url'],
  },
  async run(args, context) {
    const rawUrl = String(args.url);
    const maxChars = typeof args.maxChars === 'number' ? args.maxChars : DEFAULT_MAX_CHARS;

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(`地址格式不正确：${rawUrl}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`只支持 http/https，收到 ${url.protocol}`);
    }

    const signal = context.signal
      ? AbortSignal.any([context.signal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal,
      headers: { 'user-agent': 'xb-agent-demo/0.1', accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
    });

    const contentType = response.headers.get('content-type') ?? '未知';
    const text = await response.text();
    const truncated = text.length > maxChars;

    return [
      `状态码：${response.status} ${response.statusText}`,
      `内容类型：${contentType}`,
      truncated ? `注意：正文超过 ${maxChars} 字符，已截断` : null,
      '---',
      truncated ? text.slice(0, maxChars) : text,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  },
};
