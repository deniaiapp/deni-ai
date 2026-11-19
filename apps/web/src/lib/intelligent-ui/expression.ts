/**
 * A small arithmetic expression language for Intelligent UI calculators.
 *
 * Formulas come from model output, so they are parsed into an AST and
 * evaluated here instead of being passed to `eval`/`Function`. Only numbers,
 * declared input identifiers, a fixed set of math functions, and the operators
 * below are accepted.
 */

export type ExpressionNode =
  | { kind: "number"; value: number }
  | { kind: "identifier"; name: string }
  | { kind: "unary"; operator: "-" | "+" | "!"; operand: ExpressionNode }
  | { kind: "binary"; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode }
  | {
      kind: "conditional";
      test: ExpressionNode;
      consequent: ExpressionNode;
      alternate: ExpressionNode;
    }
  | { kind: "call"; name: FunctionName; args: ExpressionNode[] };

type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "^"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "&&"
  | "||";

const FUNCTIONS = {
  abs: { arity: [1, 1], fn: (x: number) => Math.abs(x) },
  ceil: { arity: [1, 1], fn: (x: number) => Math.ceil(x) },
  clamp: {
    arity: [3, 3],
    fn: (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
  },
  exp: { arity: [1, 1], fn: (x: number) => Math.exp(x) },
  floor: { arity: [1, 1], fn: (x: number) => Math.floor(x) },
  log: { arity: [1, 1], fn: (x: number) => Math.log(x) },
  log10: { arity: [1, 1], fn: (x: number) => Math.log10(x) },
  max: { arity: [1, 16], fn: (...xs: number[]) => Math.max(...xs) },
  min: { arity: [1, 16], fn: (...xs: number[]) => Math.min(...xs) },
  pow: { arity: [2, 2], fn: (x: number, y: number) => x ** y },
  round: {
    arity: [1, 2],
    fn: (x: number, digits = 0) => {
      const factor = 10 ** Math.min(Math.max(Math.trunc(digits), 0), 10);
      return Math.round(x * factor) / factor;
    },
  },
  sqrt: { arity: [1, 1], fn: (x: number) => Math.sqrt(x) },
} satisfies Record<string, { arity: [number, number]; fn: (...args: number[]) => number }>;

type FunctionName = keyof typeof FUNCTIONS;

const CONSTANTS: Record<string, number> = { pi: Math.PI };

const MAX_SOURCE_LENGTH = 500;
const MAX_DEPTH = 64;

type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: string }
  | { type: "end" };

const OPERATORS = [
  "**",
  "<=",
  ">=",
  "==",
  "!=",
  "&&",
  "||",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "<",
  ">",
  "!",
  "?",
  ":",
  "(",
  ")",
  ",",
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const numberMatch = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(index));
    if (numberMatch) {
      tokens.push({ type: "number", value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }
    const identifierMatch = /^[A-Za-z_]\w*/.exec(source.slice(index));
    if (identifierMatch) {
      tokens.push({ type: "identifier", value: identifierMatch[0] });
      index += identifierMatch[0].length;
      continue;
    }
    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (!operator) {
      throw new Error(`Unexpected character "${char}"`);
    }
    // `**` is accepted as an alias for `^`.
    tokens.push({ type: "operator", value: operator === "**" ? "^" : operator });
    index += operator.length;
  }
  tokens.push({ type: "end" });
  return tokens;
}

class Parser {
  private position = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ExpressionNode {
    const node = this.parseConditional();
    if (this.peek().type !== "end") {
      throw new Error("Unexpected input after expression");
    }
    return node;
  }

  private peek() {
    return this.tokens[this.position];
  }

  private next() {
    const token = this.tokens[this.position];
    this.position += 1;
    return token;
  }

  private isOperator(value: string) {
    const token = this.peek();
    return token.type === "operator" && token.value === value;
  }

  private expect(value: string) {
    if (!this.isOperator(value)) {
      throw new Error(`Expected "${value}"`);
    }
    this.next();
  }

  private enter() {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) {
      throw new Error("Expression is too deeply nested");
    }
  }

  private parseConditional(): ExpressionNode {
    this.enter();
    const test = this.parseBinary(0);
    let node = test;
    if (this.isOperator("?")) {
      this.next();
      const consequent = this.parseConditional();
      this.expect(":");
      const alternate = this.parseConditional();
      node = { kind: "conditional", test, consequent, alternate };
    }
    this.depth -= 1;
    return node;
  }

  private static readonly PRECEDENCE: [BinaryOperator[], boolean][] = [
    [["||"], false],
    [["&&"], false],
    [["==", "!="], false],
    [["<", "<=", ">", ">="], false],
    [["+", "-"], false],
    [["*", "/", "%"], false],
  ];

  private parseBinary(level: number): ExpressionNode {
    if (level >= Parser.PRECEDENCE.length) {
      return this.parseUnary();
    }
    const [operators] = Parser.PRECEDENCE[level];
    let left = this.parseBinary(level + 1);
    for (;;) {
      const token = this.peek();
      if (token.type !== "operator" || !operators.includes(token.value as BinaryOperator)) {
        return left;
      }
      this.next();
      const right = this.parseBinary(level + 1);
      left = { kind: "binary", operator: token.value as BinaryOperator, left, right };
    }
  }

  private parseUnary(): ExpressionNode {
    const token = this.peek();
    if (
      token.type === "operator" &&
      (token.value === "-" || token.value === "+" || token.value === "!")
    ) {
      this.next();
      this.enter();
      const operand = this.parseUnary();
      this.depth -= 1;
      return { kind: "unary", operator: token.value, operand };
    }
    return this.parsePower();
  }

  private parsePower(): ExpressionNode {
    const base = this.parsePrimary();
    if (this.isOperator("^")) {
      this.next();
      this.enter();
      // Right-associative, and binds tighter than unary minus on its left.
      const exponent = this.parseUnary();
      this.depth -= 1;
      return { kind: "binary", operator: "^", left: base, right: exponent };
    }
    return base;
  }

  private parsePrimary(): ExpressionNode {
    const token = this.next();
    if (token.type === "number") {
      return { kind: "number", value: token.value };
    }
    if (token.type === "identifier") {
      if (this.isOperator("(")) {
        this.next();
        if (!Object.hasOwn(FUNCTIONS, token.value)) {
          throw new Error(`Unknown function "${token.value}"`);
        }
        const name = token.value as FunctionName;
        const args: ExpressionNode[] = [];
        if (!this.isOperator(")")) {
          args.push(this.parseConditional());
          while (this.isOperator(",")) {
            this.next();
            args.push(this.parseConditional());
          }
        }
        this.expect(")");
        const [minArgs, maxArgs] = FUNCTIONS[name].arity;
        if (args.length < minArgs || args.length > maxArgs) {
          throw new Error(`Wrong number of arguments for "${name}"`);
        }
        return { kind: "call", name, args };
      }
      return { kind: "identifier", name: token.value };
    }
    if (token.type === "operator" && token.value === "(") {
      const node = this.parseConditional();
      this.expect(")");
      return node;
    }
    throw new Error("Unexpected end of expression");
  }
}

export type CompiledExpression = {
  ast: ExpressionNode;
  /** Variables the expression reads, excluding built-in constants. */
  identifiers: Set<string>;
};

function collectIdentifiers(node: ExpressionNode, into: Set<string>) {
  switch (node.kind) {
    case "number":
      return;
    case "identifier":
      if (!Object.hasOwn(CONSTANTS, node.name)) {
        into.add(node.name);
      }
      return;
    case "unary":
      collectIdentifiers(node.operand, into);
      return;
    case "binary":
      collectIdentifiers(node.left, into);
      collectIdentifiers(node.right, into);
      return;
    case "conditional":
      collectIdentifiers(node.test, into);
      collectIdentifiers(node.consequent, into);
      collectIdentifiers(node.alternate, into);
      return;
    case "call":
      for (const arg of node.args) {
        collectIdentifiers(arg, into);
      }
  }
}

export function compileExpression(source: string): CompiledExpression {
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new Error("Expression is too long");
  }
  const ast = new Parser(tokenize(source)).parse();
  const identifiers = new Set<string>();
  collectIdentifiers(ast, identifiers);
  return { ast, identifiers };
}

const truthy = (value: number) => value !== 0 && !Number.isNaN(value);

export function evaluateExpression(
  node: ExpressionNode,
  variables: Readonly<Record<string, number>>,
): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "identifier":
      if (Object.hasOwn(variables, node.name)) {
        return variables[node.name];
      }
      return Object.hasOwn(CONSTANTS, node.name) ? CONSTANTS[node.name] : Number.NaN;
    case "unary": {
      const operand = evaluateExpression(node.operand, variables);
      if (node.operator === "-") return -operand;
      if (node.operator === "!") return truthy(operand) ? 0 : 1;
      return operand;
    }
    case "conditional":
      return truthy(evaluateExpression(node.test, variables))
        ? evaluateExpression(node.consequent, variables)
        : evaluateExpression(node.alternate, variables);
    case "call":
      return (FUNCTIONS[node.name].fn as (...args: number[]) => number)(
        ...node.args.map((arg) => evaluateExpression(arg, variables)),
      );
    case "binary": {
      if (node.operator === "&&") {
        return truthy(evaluateExpression(node.left, variables)) &&
          truthy(evaluateExpression(node.right, variables))
          ? 1
          : 0;
      }
      if (node.operator === "||") {
        return truthy(evaluateExpression(node.left, variables)) ||
          truthy(evaluateExpression(node.right, variables))
          ? 1
          : 0;
      }
      const left = evaluateExpression(node.left, variables);
      const right = evaluateExpression(node.right, variables);
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "%":
          return left % right;
        case "^":
          return left ** right;
        case "<":
          return left < right ? 1 : 0;
        case "<=":
          return left <= right ? 1 : 0;
        case ">":
          return left > right ? 1 : 0;
        case ">=":
          return left >= right ? 1 : 0;
        case "==":
          return left === right ? 1 : 0;
        case "!=":
          return left !== right ? 1 : 0;
      }
    }
  }
}
