/**
 * 入口：装配依赖 → 单次问答或进入 REPL。
 * 命令行参数优先于 .env，.env 优先于内置默认值。
 */

import { resolve } from 'node:path';
import { Agent } from './agent/agent.js';
import { OpenAICompatibleClient } from './agent/llm.js';
import { buildSystemPrompt } from './agent/prompt.js';
import { printEvents, startRepl } from './cli/repl.js';
import { loadConfig, loadEnvFile } from './config.js';
import { SessionStore } from './memory/store.js';
import { createDefaultTools } from './tools/index.js';
import { ToolRegistry } from './tools/registry.js';

interface CliArgs {
  prompt?: string;
  model?: string;
  baseUrl?: string;
  workspace?: string;
  session?: string;
  maxSteps?: number;
  stream: boolean;
  verbose: boolean;
  help: boolean;
}

const USAGE = `通用 Agent 示例

用法：
  pnpm start [选项]
  pnpm start -- --prompt "帮我算一下 (12+3)*4"

选项：
  -p, --prompt <文本>     单次问答后退出
      --model <名称>      覆盖 OPENAI_MODEL
      --base-url <地址>   覆盖 OPENAI_BASE_URL
      --workspace <目录>  文件工具的工作目录
      --session <文件>    会话文件路径
      --max-steps <n>     单轮最多模型调用次数
      --no-stream         关闭流式输出
  -v, --verbose           打印完整工具返回内容
  -h, --help              显示本帮助

配置见 .env.example 与 docs/02-接入模型.md`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { stream: true, verbose: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${flag} 缺少参数值`);
      index += 1;
      return value;
    };

    switch (flag) {
      case '--':
        // pnpm / npm run 会把分隔符原样传进来
        break;
      case '-p':
      case '--prompt':
        args.prompt = next();
        break;
      case '--model':
        args.model = next();
        break;
      case '--base-url':
        args.baseUrl = next();
        break;
      case '--workspace':
        args.workspace = next();
        break;
      case '--session':
        args.session = next();
        break;
      case '--max-steps': {
        const raw = next();
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1) throw new Error(`--max-steps 需要正整数，收到 ${raw}`);
        args.maxSteps = value;
        break;
      }
      case '--no-stream':
        args.stream = false;
        break;
      case '-v':
      case '--verbose':
        args.verbose = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`未知参数：${flag}\n\n${USAGE}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  loadEnvFile(resolve(process.cwd(), '.env'));
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  const config = loadConfig();
  const model = args.model ?? config.model;
  const baseUrl = args.baseUrl ?? config.baseUrl;
  const workspace = args.workspace ? resolve(args.workspace) : config.workspace;
  const sessionFile = args.session ? resolve(args.session) : config.sessionFile;
  const stream = args.stream && config.stream;

  const tools = new ToolRegistry().registerAll(createDefaultTools());
  const llm = new OpenAICompatibleClient({ baseUrl, apiKey: config.apiKey, model });
  const agent = new Agent({
    llm,
    tools,
    systemPrompt: buildSystemPrompt({ workspace }),
    maxSteps: args.maxSteps ?? config.maxSteps,
    maxHistory: config.maxHistory,
    temperature: config.temperature,
    stream,
  });

  const store = new SessionStore(sessionFile);
  const history = store.load();
  if (history.length > 0) {
    agent.loadHistory(history);
    console.log(`已恢复 ${history.length} 条历史消息（${store.path}）`);
  }

  if (args.prompt !== undefined) {
    const final = await printEvents(agent.run(args.prompt, { workspace }), { verbose: args.verbose });
    store.save(agent.history);
    if (final === '') process.exitCode = 1;
    return;
  }

  await startRepl({ agent, store, tools, workspace, verbose: args.verbose });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n启动失败：${message}`);
  process.exitCode = 1;
});
