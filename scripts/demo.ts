/**
 * 离线演示：不填 API Key，也能完整跑一遍「模型 → 工具 → 最终答复」。
 * 使用 scripts/mock-llm.ts 提供的本地模型替身。
 */

import { Agent } from '../src/agent/agent.js';
import { OpenAICompatibleClient } from '../src/agent/llm.js';
import { buildSystemPrompt } from '../src/agent/prompt.js';
import { printEvents } from '../src/cli/repl.js';
import { createDefaultTools } from '../src/tools/index.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { startMockLLM } from './mock-llm.js';

const workspace = process.cwd();
const mock = await startMockLLM({ delayMs: 15 });

console.log(`mock 模型服务：${mock.url}`);
console.log('本演示不访问真实模型，行为由 mock 服务脚本化。\n');

try {
  const tools = new ToolRegistry().registerAll(createDefaultTools());
  const agent = new Agent({
    llm: new OpenAICompatibleClient({ baseUrl: mock.url, apiKey: 'mock', model: 'mock-model' }),
    tools,
    systemPrompt: buildSystemPrompt({ workspace }),
    maxSteps: 4,
    temperature: 0,
  });

  console.log('已注册工具：' + tools.names().join('、') + '\n');
  console.log('用户：帮我算一下 (12+3)*4 等于多少\n');

  await printEvents(agent.run('帮我算一下 (12+3)*4 等于多少', { workspace }), { verbose: true });

  console.log('\n--- 会话消息 ---');
  for (const message of agent.history) {
    const flat = message.content === null ? '' : message.content.replaceAll('\n', ' ⏎ ');
    const content = flat.length > 100 ? `${flat.slice(0, 100)}…` : flat;
    const calls = message.tool_calls?.map((call) => call.function.name).join(',') ?? '';
    console.log(`${message.role.padEnd(9)} ${content}${calls ? `  [调用 ${calls}]` : ''}`);
  }
} finally {
  await mock.close();
}
