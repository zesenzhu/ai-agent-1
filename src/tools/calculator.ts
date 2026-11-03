/**
 * 计算器工具：不用 eval，手写递归下降解析。
 *
 * 模型很容易生成 `2*(3+4)` 这类表达式，直接用 eval 等于把执行权交给模型，
 * 这里只允许数字、四则运算、取余、幂和括号。
 */

export function calculate(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  const value = parser.parseExpression();
  if (!parser.done()) {
    throw new Error(`表达式无法解析，位置 ${parser.position()}`);
  }
  if (!Number.isFinite(value)) {
    throw new Error('结果不是有限数字');
  }
  return value;
}

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '%' | '^' }
  | { kind: 'paren'; value: '(' | ')' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index] as string;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const start = index;
      while (index < input.length && /[0-9._]/.test(input[index] as string)) index += 1;
      const raw = input.slice(start, index).replaceAll('_', '');
      if (!/^\d*\.?\d+$/.test(raw) && !/^\d+\.\d*$/.test(raw)) {
        throw new Error(`非法数字：${raw}`);
      }
      tokens.push({ kind: 'number', value: Number(raw) });
      continue;
    }

    if ('+-*/%^'.includes(char)) {
      tokens.push({ kind: 'op', value: char as '+' | '-' | '*' | '/' | '%' | '^' });
      index += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', value: char });
      index += 1;
      continue;
    }

    throw new Error(`不支持的字符：${char}`);
  }

  if (tokens.length === 0) throw new Error('表达式为空');
  return tokens;
}

/**
 * 文法（优先级从低到高）：
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/' | '%') unary)*
 *   unary      := ('+' | '-') unary | power
 *   power      := primary ('^' unary)?      // 右结合
 *   primary    := number | '(' expression ')'
 */
class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parseExpression(): number {
    let value = this.parseTerm();
    while (this.matchOp('+', '-')) {
      const op = this.lastOp();
      const right = this.parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseUnary();
    while (this.matchOp('*', '/', '%')) {
      const op = this.lastOp();
      const right = this.parseUnary();
      if ((op === '/' || op === '%') && right === 0) throw new Error('除数不能为 0');
      if (op === '*') value *= right;
      else if (op === '/') value /= right;
      else value %= right;
    }
    return value;
  }

  private parseUnary(): number {
    if (this.matchOp('+')) return this.parseUnary();
    if (this.matchOp('-')) return -this.parseUnary();
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    if (this.matchOp('^')) return base ** this.parseUnary();
    return base;
  }

  private parsePrimary(): number {
    const token = this.tokens[this.index];
    if (!token) throw new Error('表达式意外结束');

    if (token.kind === 'number') {
      this.index += 1;
      return token.value;
    }

    if (token.kind === 'paren' && token.value === '(') {
      this.index += 1;
      const value = this.parseExpression();
      const close = this.tokens[this.index];
      if (!close || close.kind !== 'paren' || close.value !== ')') throw new Error('括号未闭合');
      this.index += 1;
      return value;
    }

    throw new Error(`意外的符号：${String(token.value)}`);
  }

  private matchOp(...candidates: Array<'+' | '-' | '*' | '/' | '%' | '^'>): boolean {
    const token = this.tokens[this.index];
    if (token && token.kind === 'op' && candidates.includes(token.value)) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private lastOp(): '+' | '-' | '*' | '/' | '%' | '^' {
    const token = this.tokens[this.index - 1];
    if (!token || token.kind !== 'op') throw new Error('内部解析状态异常');
    return token.value;
  }

  done(): boolean {
    return this.index >= this.tokens.length;
  }

  position(): number {
    return this.index;
  }
}

/** 去掉浮点误差噪声：0.1+0.2 输出 0.3 而不是 0.30000000000000004 */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}
