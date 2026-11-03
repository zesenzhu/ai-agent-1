import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent } from '../src/agent/agent.js';
import { OpenAICompatibleClient } from '../src/agent/llm.js';
import { buildSystemPrompt } from '../src/agent/prompt.js';
import { createDefaultTools } from '../src/tools/index.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { startMockLLM } from '../scripts/mock-llm.js';

test('端到端：mock 模型驱动一次完整工具调用', async () => {
  const workspace = process.cwd();
  const mock = await startMockLLM();

  try {
    const agent = new Agent({
      llm: new OpenAICompatibleClient({ baseUrl: mock.url, apiKey: 'mock', model: 'mock-model' }),
      tools: new ToolRegistry().registerAll(createDefaultTools()),
      systemPrompt: buildSystemPrompt({ workspace }),
      maxSteps: 4,
      stream: true,
    });

    let final = '';
    const toolNames: string[] = [];
    for await (const event of agent.run('帮我算 (12+3)*4', { workspace })) {
      if (event.type === 'tool_call') toolNames.push(event.name);
      if (event.type === 'final') final = event.text;
    }

    assert.deepEqual(toolNames, ['calculate']);
    assert.match(final, /60/);
    assert.ok(agent.history.some((message) => message.role === 'tool' && (message.content ?? '').includes('60')));
  } finally {
    await mock.close();
  }
});
