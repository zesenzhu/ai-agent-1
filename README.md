# 通用 Agent 示例

一个**能跑、能读、能改**的最小通用 agent：模型 + 工具 + 循环 + 记忆 + CLI。
代码量约 1600 行（含中文注释），零运行时依赖（只用 Node 内置的 `fetch`），协议层手写 OpenAI Chat Completions。

它不是框架，而是一份「把 agent 拆开看」的参考实现：

- 想理解 agent 到底在做什么 → 读 `src/agent/agent.ts` 的 `drive()`，一个 `for` 循环而已；
- 想接自己的模型 → 只改 `OPENAI_BASE_URL`，协议是通用的；
- 想加自己的工具 → 写一个对象，注册一行，见 `docs/03-编写工具.md`。

## 30 秒跑起来（不需要 API Key）

```bash
pnpm install
pnpm demo
```

`pnpm demo` 会启动一个本地 mock 模型服务，完整跑一遍「模型请求工具 → 执行 → 回填 → 最终答复」，并打印会话消息。

真实输出：

```text
→ calculate({"expression":"(12+3)*4"})
✓ (12+3)*4 = 60
工具返回：(12+3)*4 = 60

任务完成。
```

## 接真实模型

```bash
cp .env.example .env
# 编辑 .env，填 OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL
pnpm start
```

任何 OpenAI 兼容端点都可以（DeepSeek、Moonshot、通义、OpenAI、Ollama），各家配置见 `docs/02-接入模型.md`。

单次问答：

```bash
pnpm start -- --prompt "现在几点？顺便算一下 0.1+0.2"
```

## 目录结构

```text
src/
├── index.ts              # 入口：解析参数、装配依赖、单次问答或 REPL
├── config.ts             # .env 加载与配置校验
├── agent/
│   ├── agent.ts          # 核心循环：模型 ⇄ 工具，事件流输出
│   ├── llm.ts            # OpenAI 兼容客户端（SSE 流式 + 工具调用拼接）
│   ├── messages.ts       # 会话消息类型
│   └── prompt.ts         # 系统提示词
├── tools/
│   ├── registry.ts       # 工具注册与执行（失败也返回文本，不抛异常）
│   ├── schema.ts         # 极简 JSON Schema 校验
│   ├── calculator.ts     # 手写表达式解析（不用 eval）
│   ├── fs.ts             # 沙箱内文件读写
│   ├── http.ts           # 只读 HTTP GET
│   ├── time.ts           # 当前时间
│   └── index.ts          # 内置工具集合
├── memory/store.ts       # 会话持久化（原子写入）
└── cli/repl.ts           # 终端渲染与 REPL 命令
scripts/
├── mock-llm.ts           # 本地 mock 模型服务（SSE + 工具调用分片）
└── demo.ts               # 离线演示
test/                     # node:test，29 个用例
docs/                     # 中文文档
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm demo` | 离线演示，不需要 API Key |
| `pnpm start` | 进入 REPL |
| `pnpm start -- --prompt "..."` | 单次问答 |
| `pnpm mock-llm` | 单独启动 mock 模型服务（端口 11435） |
| `pnpm typecheck` | TypeScript 严格模式检查 |
| `pnpm test` | 单元测试 + 端到端测试 |

REPL 命令：`/help`、`/tools`、`/history`、`/reset`、`/quit`。

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | 模型服务地址，不带 `/chat/completions` |
| `OPENAI_API_KEY` | 无（必填） | 本地 Ollama 可填任意非空值 |
| `OPENAI_MODEL` | 无（必填） | 模型名称 |
| `AGENT_TEMPERATURE` | `0.3` | 采样温度 |
| `AGENT_MAX_STEPS` | `8` | 单轮最多模型调用次数 |
| `AGENT_MAX_HISTORY` | `40` | 保留的非 system 消息条数 |
| `AGENT_WORKSPACE` | 当前目录 | 文件工具沙箱根目录 |
| `AGENT_SESSION_FILE` | `.agent-session.json` | 会话文件 |
| `AGENT_STREAM` | `true` | 是否流式输出 |

命令行参数优先于环境变量：`--model`、`--base-url`、`--workspace`、`--session`、`--max-steps`、`--no-stream`、`-v`。

## 文档

- [01-工作原理](docs/01-工作原理.md)：消息协议、工具调用循环、流式拼接、裁剪策略
- [02-接入模型](docs/02-接入模型.md)：各家端点配置与错误排查
- [03-编写工具](docs/03-编写工具.md)：工具接口、参数校验、安全边界
- [04-会话与扩展](docs/04-会话与扩展.md)：持久化、换 UI、以及往下能加什么

## 边界

这是**学习与二次开发的起点**，不是生产成品：

- 工具串行执行，没有并行调用与中断审批；
- 记忆是「全量消息 + 条数裁剪」，没有摘要、向量检索；
- 会话是单文件，没有多用户隔离与鉴权；
- `http_get` 没有域名白名单，接入生产前必须加。

这些都在 `docs/04-会话与扩展.md` 里写了具体的加法。
