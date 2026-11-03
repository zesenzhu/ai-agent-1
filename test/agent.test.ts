import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent, type AgentEvent } from '../src/agent/agent.js';
import type { ChatRequest, ChatResult, LLMClient } from '../src/agent/llm.js';
import type { ChatMessage } from '../src/agent/messages.js';
import { calculateTool } from '../src/tools/index.js';
import { ToolRegistry } from '../src/tools/registry.js';

/** 按脚本依次返回响应的模型替身，同时记录每次请求，便于断言上下文。 */
class ScriptedLLM implements LLMClient {
  readonly requests: ChatRequest[] = [];
  private readonly steps: Array<(request: ChatRequest) => ChatResult>;

  constructor(steps: Array<(request: ChatRequest) => ChatResult>) {
    this.steps = [...steps];
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    this.requests.push(request);
    const step = this.steps.shift();
    if (!step) throw new Error('脚本已用尽');
    return step(request);
  }
}

function toolCallStep(name = 'calculate', args = '{"expression":"2*(3+4)"}'): ChatResult {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: args } }],
    },
    finishReason: 'tool_calls',
    usage: null,
  };
}

function finalStep(text: string): ChatResult {
  return { message: { role: 'assistant', content: text }, finishReason: 'stop', usage: null };
}

function createAgent(llm: LLMClient, options: { maxSteps?: number; maxHistory?: number } = {}): Agent {
  return new Agent({
    llm,
    tools: new ToolRegistry().registerAll([calculateTool]),
    systemPrompt: '测试用提示词',
    stream: false,
    ...options,
  });
}

async function collect(agent: Agent, input: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.run(input, { workspace: process.cwd() })) events.push(event);
  return events;
}

test('模型请求工具后，结果被回填并产出最终答复', async () => {
  const llm = new ScriptedLLM([() => toolCallStep(), () => finalStep('结果是 14')]);
  const agent = createAgent(llm);

  const events = await collect(agent, '2*(3+4) 等于多少');
  assert.deepEqual(
    events.map((event) => event.type),
    ['tool_call', 'tool_result', 'final'],
  );

  const toolResult = events.find((event) => event.type === 'tool_result');
  assert.ok(toolResult && toolResult.type === 'tool_result');
  assert.equal(toolResult.ok, true);
  assert.match(toolResult.content, /14/);

  const final = events.at(-1);
  assert.ok(final && final.type === 'final');
  assert.equal(final.text, '结果是 14');

  // 第二次请求必须带上 assistant(tool_calls) 与对应的 tool 消息，否则接口会拒绝
  assert.equal(llm.requests.length, 2);
  const second = llm.requests[1]?.messages ?? [];
  const assistantCall = second.find((message) => message.role === 'assistant' && message.tool_calls);
  const toolMessage = second.find((message) => message.role === 'tool');
  assert.ok(assistantCall?.tool_calls?.[0]);
  assert.equal(toolMessage?.tool_call_id, assistantCall.tool_calls[0].id);
  assert.match(toolMessage?.content ?? '', /14/);
});

test('工具调用达到上限时撤掉工具并强制收尾', async () => {
  const llm = new ScriptedLLM([() => toolCallStep(), () => finalStep('兜底答复')]);
  const agent = createAgent(llm, { maxSteps: 1 });

  const events = await collect(agent, '算一下');
  assert.ok(events.some((event) => event.type === 'step_limit'));
  assert.equal(events.at(-1)?.type, 'final');
  assert.equal(llm.requests.length, 2);
  assert.equal(llm.requests[1]?.tools, undefined);
  assert.match(llm.requests[1]?.messages.at(-1)?.content ?? '', /不要再请求调用工具/);
});

test('模型报错时异常向上抛出，不会静默结束', async () => {
  const agent = createAgent(new ScriptedLLM([]));
  await assert.rejects(async () => {
    for await (const _event of agent.run('任意输入', { workspace: process.cwd() })) {
      // 只消费事件流
    }
  }, /脚本已用尽/);
});

test('历史裁剪后 system 保留，且不会以孤立的 tool 消息开头', async () => {
  const steps: Array<(request: ChatRequest) => ChatResult> = [];
  for (let index = 0; index < 3; index += 1) {
    steps.push(() => toolCallStep(), () => finalStep(`第 ${index + 1} 轮完成`));
  }
  const llm = new ScriptedLLM(steps);
  const agent = createAgent(llm, { maxHistory: 3 });

  for (let index = 0; index < 3; index += 1) await collect(agent, `第 ${index + 1} 个问题`);

  const history = [...agent.history];
  assert.equal(history[0]?.role, 'system');
  assert.ok(history.length <= 4, `历史应被裁剪，实际 ${history.length} 条`);
  assert.notEqual(history[1]?.role, 'tool');
});

test('reset 清空对话但保留 system 提示词', async () => {
  const agent = createAgent(new ScriptedLLM([() => finalStep('好')]));
  await collect(agent, '你好');
  agent.reset();

  const history: readonly ChatMessage[] = agent.history;
  assert.equal(history.length, 1);
  assert.equal(history[0]?.role, 'system');
});
