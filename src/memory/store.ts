/**
 * 会话持久化：把消息数组落成 JSON，退出后还能接着聊。
 *
 * 生产场景通常换数据库或 Redis，但形状不变：
 * 一份「按会话 id 存消息数组」的存储，加上原子写入。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ChatMessage, Role } from '../agent/messages.js';

const SESSION_VERSION = 1;
const ROLES: readonly Role[] = ['system', 'user', 'assistant', 'tool'];

export interface SessionData {
  version: number;
  updatedAt: string;
  messages: ChatMessage[];
}

export class SessionStore {
  private readonly file: string;

  constructor(file: string) {
    this.file = resolve(file);
  }

  get path(): string {
    return this.file;
  }

  /** 文件不存在或格式损坏时返回空数组，不让历史拖垮启动。 */
  load(): ChatMessage[] {
    if (!existsSync(this.file)) return [];

    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SessionData>;
      if (data.version !== SESSION_VERSION || !Array.isArray(data.messages)) return [];
      return data.messages.filter(isChatMessage);
    } catch {
      return [];
    }
  }

  save(messages: readonly ChatMessage[]): void {
    const data: SessionData = {
      version: SESSION_VERSION,
      updatedAt: new Date().toISOString(),
      messages: [...messages],
    };
    mkdirSync(dirname(this.file), { recursive: true });

    // 先写临时文件再改名，避免进程中断留下半截 JSON
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.file);
  }

  clear(): void {
    if (existsSync(this.file)) rmSync(this.file);
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ChatMessage>;
  if (typeof candidate.role !== 'string' || !ROLES.includes(candidate.role as Role)) return false;
  return candidate.content === null || typeof candidate.content === 'string';
}
