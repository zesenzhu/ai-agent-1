/**
 * 本地 mock 模型服务：实现 OpenAI Chat Completions 的最小可用子集。
 *
 * 用途：
 * 1. 没有 API Key 也能跑通完整链路（含 SSE 流式与工具调用分片拼接）；
 * 2. 测试里作为确定性的模型替身，不依赖外部网络。
 *
 * 行为是脚本化的：第一次调用返回 calculate 工具调用，
 * 收到工具结果后返回一段最终答复。
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockLLMOptions {
  port?: number;
  host?: string;
  /** 每个分片之间的延迟，用于观察流式效果，默认 0 */
  delayMs?: number;
}

export interface MockLLM {
  url: string;
  close(): Promise<void>;
}

interface WireMessage {
  role?: string;
  content?: string | null;
}

interface ChatRequestBody {
  model?: string;
  stream?: boolean;
  messages?: WireMessage[];
}

const DEFAULT_EXPRESSION = '(12+3)*4';

export async function startMockLLM(options: MockLLMOptions = {}): Promise<MockLLM> {
  const delayMs = options.delayMs ?? 0;

  const server = createServer((request, response) => {
    void handle(request, response, delayMs).catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    });
  });

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.once('error', reject);
  server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
    server.off('error', reject);
    resolve();
  });
  await promise;

  const address = server.address() as AddressInfo;

  return {
    url: `http://${options.host ?? '127.0.0.1'}:${address.port}/v1`,
    close: () => {
      const { promise: closed, resolve: done, reject: fail } = Promise.withResolvers<void>();
      server.close((error) => (error ? fail(error) : done()));
      return closed;
    },
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  delayMs: number,
): Promise<void> {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: '仅支持 POST /v1/chat/completions' } }));
    return;
  }

  const body = JSON.parse(await readBody(request)) as ChatRequestBody;
  const messages = body.messages ?? [];
  const lastTool = [...messages].reverse().find((message) => message.role === 'tool');
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');

  if (lastTool) {
    const answer = `工具返回：${lastTool.content ?? ''}\n\n任务完成。`;
    if (body.stream) await streamText(response, answer, delayMs);
    else sendJson(response, completionMessage({ content: answer, finishReason: 'stop' }));
    return;
  }

  const expression = extractExpression(lastUser?.content ?? '') ?? DEFAULT_EXPRESSION;
  const argument = JSON.stringify({ expression });

  if (body.stream) {
    await streamToolCall(response, argument, delayMs);
  } else {
    sendJson(
      response,
      completionMessage({
        content: null,
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_mock_1', type: 'function', function: { name: 'calculate', arguments: argument } }],
      }),
    );
  }
}

/** 从用户输入里抠出第一个疑似算式，抠不到就用默认表达式。 */
function extractExpression(text: string): string | null {
  const match = /[-+(]*\d[\d\s.+\-*/%^()]*/.exec(text);
  if (!match) return null;
  const expression = match[0].trim().replace(/\s+/g, ' ');
  return expression === '' ? null : expression;
}

function completionMessage(options: {
  content: string | null;
  finishReason: string;
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}): object {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    model: 'mock-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: options.content,
          ...(options.toolCalls ? { tool_calls: options.toolCalls } : {}),
        },
        finish_reason: options.finishReason,
      },
    ],
    usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 },
  };
}

function sendJson(response: ServerResponse, payload: object): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function openStream(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
}

function writeChunk(response: ServerResponse, chunk: object): void {
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function deltaChunk(delta: object, finishReason: string | null = null): object {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    model: 'mock-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
}

/** 把工具调用拆成多个分片，名字和参数各切一半，用于验证客户端的增量拼接。 */
async function streamToolCall(response: ServerResponse, argument: string, delayMs: number): Promise<void> {
  openStream(response);

  writeChunk(response, deltaChunk({ role: 'assistant', content: null }));
  await sleep(delayMs);

  writeChunk(
    response,
    deltaChunk({
      tool_calls: [{ index: 0, id: 'call_mock_1', type: 'function', function: { name: 'calc', arguments: '' } }],
    }),
  );
  await sleep(delayMs);

  writeChunk(response, deltaChunk({ tool_calls: [{ index: 0, function: { name: 'ulate' } }] }));
  await sleep(delayMs);

  const middle = Math.floor(argument.length / 2);
  writeChunk(response, deltaChunk({ tool_calls: [{ index: 0, function: { arguments: argument.slice(0, middle) } }] }));
  await sleep(delayMs);

  writeChunk(response, deltaChunk({ tool_calls: [{ index: 0, function: { arguments: argument.slice(middle) } }] }));
  await sleep(delayMs);

  writeChunk(response, deltaChunk({}, 'tool_calls'));
  response.write('data: [DONE]\n\n');
  response.end();
}

async function streamText(response: ServerResponse, text: string, delayMs: number): Promise<void> {
  openStream(response);

  writeChunk(response, deltaChunk({ role: 'assistant', content: '' }));
  for (const piece of splitText(text, 12)) {
    await sleep(delayMs);
    writeChunk(response, deltaChunk({ content: piece }));
  }
  writeChunk(response, deltaChunk({}, 'stop'));
  response.write('data: [DONE]\n\n');
  response.end();
}

function splitText(text: string, size: number): string[] {
  const pieces: string[] = [];
  for (let index = 0; index < text.length; index += size) pieces.push(text.slice(index, index + size));
  return pieces;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// 直接执行本文件时启动服务，供 `pnpm mock-llm` 手动调试
if (process.argv[1]?.endsWith('mock-llm.ts') || process.argv[1]?.endsWith('mock-llm.js')) {
  const server = await startMockLLM({ port: Number(process.env.MOCK_LLM_PORT ?? 11435), delayMs: 20 });
  console.log(`mock 模型服务已启动：${server.url}`);
  console.log('用法：OPENAI_BASE_URL=' + server.url + ' OPENAI_API_KEY=mock OPENAI_MODEL=mock-model pnpm start');
}
