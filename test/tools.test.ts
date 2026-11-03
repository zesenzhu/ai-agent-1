import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveInsideWorkspace } from '../src/tools/fs.js';
import { createDefaultTools } from '../src/tools/index.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { Tool } from '../src/tools/types.js';

const context = { workspace: process.cwd() };

test('未知工具返回可读错误而不是抛异常', async () => {
  const result = await new ToolRegistry().execute('nope', '{}', context);
  assert.equal(result.ok, false);
  assert.match(result.content, /未知工具/);
});

test('参数不是合法 JSON 时提示模型重试', async () => {
  const registry = new ToolRegistry().registerAll(createDefaultTools());
  const result = await registry.execute('calculate', '{"expression":', context);
  assert.equal(result.ok, false);
  assert.match(result.content, /参数不是合法 JSON/);
});

test('参数校验失败时指出具体字段', async () => {
  const registry = new ToolRegistry().registerAll(createDefaultTools());
  const result = await registry.execute('calculate', '{}', context);
  assert.equal(result.ok, false);
  assert.match(result.content, /arguments\.expression 缺失/);
});

test('工具内部异常被转换成结果文本', async () => {
  const failing: Tool = {
    name: 'boom',
    description: '总是失败',
    parameters: { type: 'object' },
    run() {
      throw new Error('磁盘已满');
    },
  };
  const result = await new ToolRegistry().register(failing).execute('boom', '{}', context);
  assert.equal(result.ok, false);
  assert.match(result.content, /磁盘已满/);
});

test('重名工具在注册阶段就报错', () => {
  const registry = new ToolRegistry().registerAll(createDefaultTools());
  assert.throws(() => registry.registerAll(createDefaultTools()), /工具重名/);
});

test('文件工具在沙箱内完成写入、读取和列目录', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'xb-agent-'));
  const registry = new ToolRegistry().registerAll(createDefaultTools());

  try {
    const written = await registry.execute(
      'write_file',
      JSON.stringify({ path: 'notes/a.txt', content: '你好，agent' }),
      { workspace },
    );
    assert.equal(written.ok, true, written.content);

    const read = await registry.execute('read_file', JSON.stringify({ path: 'notes/a.txt' }), { workspace });
    assert.equal(read.ok, true);
    assert.match(read.content, /你好，agent/);
    assert.equal(await readFile(join(workspace, 'notes/a.txt'), 'utf8'), '你好，agent');

    const listed = await registry.execute('list_dir', '{}', { workspace });
    assert.match(listed.content, /notes/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('越界路径在解析阶段被拒绝', async () => {
  assert.throws(() => resolveInsideWorkspace('/tmp/work', '../etc/passwd'), /路径越界/);
  assert.throws(() => resolveInsideWorkspace('/tmp/work', '/etc/passwd'), /路径越界/);
  assert.equal(resolveInsideWorkspace('/tmp/work', 'a/../b.txt'), '/tmp/work/b.txt');

  const registry = new ToolRegistry().registerAll(createDefaultTools());
  const result = await registry.execute('read_file', JSON.stringify({ path: '../../etc/passwd' }), {
    workspace: '/tmp/work',
  });
  assert.equal(result.ok, false);
  assert.match(result.content, /路径越界/);
});

test('计算工具返回算式与结果', async () => {
  const registry = new ToolRegistry().registerAll(createDefaultTools());
  const result = await registry.execute('calculate', JSON.stringify({ expression: '2*(3+4)' }), context);
  assert.equal(result.content, '2*(3+4) = 14');
});
