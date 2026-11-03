/**
 * 终端交互层：把 AgentEvent 渲染成人类可读的输出，并提供 REPL 命令。
 * 事件流是唯一的界面契约，换成 Web / 微信 / 飞书时只需要换这一层。
 */

import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type { Agent, AgentEvent } from '../agent/agent.js';
import type { SessionStore } from '../memory/store.js';
import type { ToolRegistry } from '../tools/registry.js';

export interface ReplOptions {
  agent: Agent;
  store: SessionStore;
  tools: ToolRegistry;
  workspace: string;
  /** 打印完整工具返回内容，默认只打印首行摘要 */
  verbose?: boolean;
}

const colorEnabled = stdout.isTTY === true && process.env.NO_COLOR === undefined;

const paint = (code: string) => (text: string) => (colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = paint('2');
const cyan = paint('36');
const green = paint('32');
const red = paint('31');
const yellow = paint('33');
const bold = paint('1');

function truncate(text: string, max: number): string {
  const flat = text.replaceAll('\n', ' ⏎ ');
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/**
 * 消费事件流并输出。返回最终答复文本。
 * 流式模式下 delta 直接落屏，final 事件只负责收尾，避免内容重复打印。
 */
export async function printEvents(
  events: AsyncIterable<AgentEvent>,
  options: { verbose?: boolean } = {},
): Promise<string> {
  let streamed = false;
  let finalText = '';

  for await (const event of events) {
    switch (event.type) {
      case 'delta':
        stdout.write(event.text);
        streamed = true;
        break;
      case 'tool_call':
        if (streamed) stdout.write('\n');
        streamed = false;
        stdout.write(dim(`→ ${event.name}(${truncate(event.args, 200)})\n`));
        break;
      case 'tool_result':
        stdout.write(dim(`${event.ok ? green('✓') : red('✗')} ${truncate(event.content, options.verbose ? 2000 : 200)}\n`));
        break;
      case 'final':
        finalText = event.text;
        if (!streamed && event.text !== '') stdout.write(event.text);
        stdout.write('\n');
        break;
      case 'step_limit':
        stdout.write(yellow(`! 工具调用已达 ${event.steps} 轮上限，正在强制收尾\n`));
        break;
    }
  }

  return finalText;
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const { agent, store, tools, workspace } = options;
  const readline = createInterface({ input: stdin, output: stdout });

  stdout.write(bold('通用 Agent 示例') + dim(`  ·  工作目录 ${workspace}`) + '\n');
  stdout.write(dim('输入 /help 查看命令，/quit 退出。\n\n'));

  while (true) {
    let line: string;
    try {
      line = await readline.question(cyan('你 › '));
    } catch {
      break; // Ctrl+D / 输入流关闭
    }

    const input = line.trim();
    if (input === '') continue;

    if (input.startsWith('/')) {
      const shouldExit = await handleCommand(input, { agent, store, tools });
      if (shouldExit) break;
      continue;
    }

    try {
      await printEvents(agent.run(input, { workspace }), { verbose: options.verbose });
      store.save(agent.history);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stdout.write(`${red('请求失败：')}${message}\n`);
      if (error instanceof Error && 'detail' in error && typeof error.detail === 'string' && error.detail !== '') {
        stdout.write(dim(truncate(error.detail, 500)) + '\n');
      }
    }
  }

  readline.close();
  stdout.write(dim('\n会话已保存，再见。\n'));
}

async function handleCommand(input: string, context: Omit<ReplOptions, 'workspace' | 'verbose'>): Promise<boolean> {
  const [command] = input.split(/\s+/);

  switch (command) {
    case '/quit':
    case '/exit':
      return true;
    case '/help':
      stdout.write(
        [
          '可用命令：',
          '  /help     显示帮助',
          '  /tools    列出已注册工具',
          '  /history  查看当前会话消息条数与角色分布',
          '  /reset    清空会话历史（同时删除会话文件）',
          '  /quit     退出',
          '',
        ].join('\n'),
      );
      return false;
    case '/tools':
      for (const schema of context.tools.schemas()) {
        stdout.write(`${bold(schema.function.name)}  ${dim(schema.function.description)}\n`);
      }
      stdout.write('\n');
      return false;
    case '/history': {
      const messages = context.agent.history;
      const counts = new Map<string, number>();
      for (const message of messages) counts.set(message.role, (counts.get(message.role) ?? 0) + 1);
      const summary = [...counts.entries()].map(([role, count]) => `${role} ${count}`).join('，');
      stdout.write(dim(`共 ${messages.length} 条消息：${summary}；文件 ${context.store.path}\n`));
      return false;
    }
    case '/reset':
      context.agent.reset();
      context.store.clear();
      stdout.write(dim('会话已重置。\n'));
      return false;
    default:
      stdout.write(yellow(`未知命令：${command}，输入 /help 查看可用命令。\n`));
      return false;
  }
}
