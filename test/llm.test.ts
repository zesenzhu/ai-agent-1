import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { LLMError, OpenAICompatibleClient } from '../src/agent/llm.js';
import { startMockLLM } from '../scripts/mock-llm.js';

test('流式响应里被切碎的工具调用能正确拼接', async () => {
  const mock = await startMockLLM();
  try {
    const client = new OpenAICompatibleClient({ baseUrl: mock.url, apiKey: 'mock', model: 'mock-model' });
    const result = await client.chat({
      messages: [{ role: 'user', content: '算 (12+3)*4' }],
      tools: [{ type: 'function', function: { name: 'calculate', description: '计算', parameters: { type: 'object' } } }],
    });

    const call = result.message.tool_calls?.[0];
    assert.ok(call, '应解析出工具调用');
    // mock 服务把名字拆成 calc + ulate，参数拆成两段
    assert.equal(call.function.name, 'calculate');
    assert.deepEqual(JSON.parse(call.function.arguments), { expression: '(12+3)*4' });
    assert.equal(result.finishReason, 'tool_calls');
    assert.equal(result.message.content, null);
  } finally {
    await mock.close();
  }
});

test('流式文本增量与最终内容一致', async () => {
  const mock = await startMockLLM();
  try {
    const client = new OpenAICompatibleClient({ baseUrl: mock.url, apiKey: 'mock', model: 'mock-model' });
    const deltas: string[] = [];
    const result = await client.chat({
      messages: [
        { role: 'user', content: '算一下' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_mock_1', type: 'function', function: { name: 'calculate', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'call_mock_1', content: '(12+3)*4 = 60' },
      ],
      onDelta: (text) => deltas.push(text),
    });

    assert.ok(deltas.length > 1, '应分多段返回');
    assert.equal(deltas.join(''), result.message.content);
    assert.match(result.message.content ?? '', /60/);
  } finally {
    await mock.close();
  }
});

test('非流式 JSON 响应同样可用', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      );
    },
    async (baseUrl) => {
      const client = new OpenAICompatibleClient({ baseUrl, apiKey: 'k', model: 'm' });
      const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false });
      assert.equal(result.message.content, '你好');
      assert.deepEqual(result.usage, { promptTokens: 3, completionTokens: 2 });
    },
  );
});

test('接口报错时抛出带状态码的 LLMError', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    },
    async (baseUrl) => {
      const client = new OpenAICompatibleClient({ baseUrl, apiKey: 'bad', model: 'm' });
      await assert.rejects(
        () => client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false }),
        (error: unknown) => {
          assert.ok(error instanceof LLMError);
          assert.equal(error.status, 401);
          assert.match(error.detail ?? '', /invalid api key/);
          return true;
        },
      );
    },
  );
});

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', onListening);
  await listening;

  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    server.close(() => onClosed());
    await closed;
  }
}
