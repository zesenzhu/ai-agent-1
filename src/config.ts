/**
 * 配置加载：读 .env（不覆盖已有环境变量）+ 校验 + 默认值。
 *
 * 自己解析 .env 而不是引入 dotenv，是为了让这个示例保持零运行时依赖；
 * 生产项目直接用 Node 的 --env-file 或框架自带的配置模块即可。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxSteps: number;
  maxHistory: number;
  workspace: string;
  sessionFile: string;
  stream: boolean;
}

/** 极简 .env 解析：支持 # 注释、引号包裹、空行。已存在的环境变量优先。 */
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if (env[key] === undefined) env[key] = value;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const model = env.OPENAI_MODEL?.trim();
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!model) {
    throw new Error('缺少 OPENAI_MODEL，请参考 .env.example 配置模型名称');
  }
  if (!apiKey) {
    throw new Error('缺少 OPENAI_API_KEY。使用本地 Ollama 时可填任意非空值，例如 ollama');
  }

  return {
    baseUrl,
    apiKey,
    model,
    temperature: readNumber(env.AGENT_TEMPERATURE, 0.3, 'AGENT_TEMPERATURE'),
    maxSteps: readNumber(env.AGENT_MAX_STEPS, 8, 'AGENT_MAX_STEPS'),
    maxHistory: readNumber(env.AGENT_MAX_HISTORY, 40, 'AGENT_MAX_HISTORY'),
    workspace: resolve(env.AGENT_WORKSPACE?.trim() || process.cwd()),
    sessionFile: resolve(env.AGENT_SESSION_FILE?.trim() || '.agent-session.json'),
    stream: readBoolean(env.AGENT_STREAM, true, 'AGENT_STREAM'),
  };
}

function readNumber(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} 不是合法数字：${raw}`);
  return value;
}

function readBoolean(raw: string | undefined, fallback: boolean, key: string): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`${key} 不是合法布尔值：${raw}`);
}
