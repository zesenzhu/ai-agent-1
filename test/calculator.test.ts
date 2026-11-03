import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate, formatNumber } from '../src/tools/calculator.js';

test('按优先级计算四则运算', () => {
  assert.equal(calculate('2+3*4'), 14);
  assert.equal(calculate('(2+3)*4'), 20);
  assert.equal(calculate('10-2-3'), 5);
  assert.equal(calculate('100/4/5'), 5);
  assert.equal(calculate('10%3'), 1);
});

test('支持一元正负号和右结合幂', () => {
  assert.equal(calculate('-3+10'), 7);
  assert.equal(calculate('--5'), 5);
  assert.equal(calculate('2^3^2'), 512);
  assert.equal(calculate('-(2+3)*2'), -10);
});

test('除数为 0 时抛出可读错误', () => {
  assert.throws(() => calculate('1/0'), /除数不能为 0/);
  assert.throws(() => calculate('5%0'), /除数不能为 0/);
});

test('拒绝非数学字符，不执行任意代码', () => {
  assert.throws(() => calculate('process.exit(1)'), /不支持的字符/);
  assert.throws(() => calculate('1;2'), /不支持的字符/);
});

test('括号缺失和表达式残缺时报错', () => {
  assert.throws(() => calculate('(1+2'), /括号未闭合/);
  assert.throws(() => calculate('1+'), /表达式意外结束/);
  assert.throws(() => calculate(''), /表达式为空/);
});

test('结果格式化消除浮点噪声', () => {
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(60), '60');
  assert.equal(formatNumber(1 / 3), '0.333333333333');
});
