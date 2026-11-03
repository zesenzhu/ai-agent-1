/**
 * 时间工具：模型本身不知道「现在」，必须由工具提供，否则回答里的日期是训练数据里的旧值。
 */

import type { Tool } from './types.js';

export const getCurrentTimeTool: Tool = {
  name: 'get_current_time',
  description: '获取当前日期时间。可选传入 IANA 时区（如 Asia/Shanghai），默认使用运行环境的本地时区。',
  parameters: {
    type: 'object',
    properties: {
      timezone: { type: 'string', description: 'IANA 时区名，例如 Asia/Shanghai、UTC' },
    },
  },
  run(args) {
    const now = new Date();
    const timezone = typeof args.timezone === 'string' && args.timezone !== '' ? args.timezone : undefined;

    let local: string;
    try {
      local = now.toLocaleString('zh-CN', {
        timeZone: timezone,
        hour12: false,
        dateStyle: 'full',
        timeStyle: 'medium',
      });
    } catch {
      throw new Error(`无效的时区：${timezone}`);
    }

    const resolvedZone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return [`当前时间：${local}`, `时区：${resolvedZone}`, `ISO 8601：${now.toISOString()}`].join('\n');
  },
};
