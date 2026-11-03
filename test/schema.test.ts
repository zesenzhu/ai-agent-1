import assert from 'node:assert/strict';
import test from 'node:test';
import { validateArgs } from '../src/tools/schema.js';
import type { JsonSchema } from '../src/tools/types.js';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 10 },
    mode: { type: 'string', enum: ['read', 'write'] },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['path'],
};

test('合法参数通过校验', () => {
  assert.deepEqual(validateArgs(schema, { path: 'a.txt', limit: 3, mode: 'read', tags: ['x'] }), []);
});

test('缺少必填字段时报出字段路径', () => {
  const errors = validateArgs(schema, {});
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? '', /arguments\.path 缺失/);
});

test('类型不符时逐项报错', () => {
  const errors = validateArgs(schema, { path: 1, limit: 2.5, tags: [1] });
  assert.match(errors.join('\n'), /arguments\.path 应为字符串/);
  assert.match(errors.join('\n'), /arguments\.limit 应为整数/);
  assert.match(errors.join('\n'), /arguments\.tags\[0\] 应为字符串/);
});

test('枚举和数值区间被强制', () => {
  assert.match(validateArgs(schema, { path: 'a', mode: 'delete' }).join(''), /只能是 read \/ write/);
  assert.match(validateArgs(schema, { path: 'a', limit: 0 }).join(''), /不能小于 1/);
  assert.match(validateArgs(schema, { path: 'a', limit: 11 }).join(''), /不能大于 10/);
});

test('非对象入参直接拒绝', () => {
  assert.match(validateArgs(schema, []).join(''), /应为对象/);
  assert.match(validateArgs(schema, null).join(''), /应为对象/);
});
