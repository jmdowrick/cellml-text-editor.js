/**
 * The CellML 2.0 MathML subset, and how CellML Text maps onto it.
 *
 * The parser, the text generator and the LaTeX generator all read this module,
 * so the three always agree on which functions exist and how they are written.
 */

export const CELLML_NS = 'http://www.cellml.org/cellml/2.0#'
export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

/** Every element CellML 2.0 permits inside <math> (CellML 2.0 specification, section 14.1). */
export const CELLML_MATHML_ELEMENTS: ReadonlySet<string> = new Set([
  // Structure
  'math', 'apply', 'ci', 'cn', 'sep', 'piecewise', 'piece', 'otherwise', 'bvar', 'degree', 'logbase',
  // Relations
  'eq', 'neq', 'gt', 'lt', 'geq', 'leq',
  // Logic
  'and', 'or', 'xor', 'not',
  // Arithmetic
  'plus', 'minus', 'times', 'divide', 'power', 'root', 'abs', 'exp', 'ln', 'log', 'floor', 'ceiling',
  'min', 'max', 'rem',
  // Calculus
  'diff',
  // Trigonometry
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
  'arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot',
  'arcsinh', 'arccosh', 'arctanh', 'arcsech', 'arccsch', 'arccoth',
  // Constants
  'pi', 'exponentiale', 'notanumber', 'infinity', 'true', 'false',
])

export type ArgKind = 'numeric' | 'boolean'

export interface FunctionSpec {
  /** The MathML operator element the call becomes. */
  element: string
  minArgs: number
  maxArgs: number
  /** Boolean arguments are parsed as conditions, so `not(a > b)` works. */
  argKind: ArgKind
  /** What the arguments are, for argument-count errors. */
  usage?: string
}

const unary = (element: string): FunctionSpec => ({ element, minArgs: 1, maxArgs: 1, argKind: 'numeric' })

const TRIG = [
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
  'arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot',
  'arcsinh', 'arccosh', 'arctanh', 'arcsech', 'arccsch', 'arccoth',
]

/** The functions CellML Text accepts, by the name they are written with. */
export const FUNCTIONS: Readonly<Record<string, FunctionSpec>> = {
  sqrt: { element: 'root', minArgs: 1, maxArgs: 1, argKind: 'numeric', usage: 'the value' },
  root: { element: 'root', minArgs: 2, maxArgs: 2, argKind: 'numeric', usage: 'the value and the degree' },
  log: { element: 'log', minArgs: 1, maxArgs: 2, argKind: 'numeric', usage: 'the value, and optionally the base' },
  ode: {
    element: 'diff',
    minArgs: 2,
    maxArgs: 3,
    argKind: 'numeric',
    usage: 'the variable, the variable it is differentiated with respect to, and optionally the order',
  },
  power: { element: 'power', minArgs: 2, maxArgs: 2, argKind: 'numeric', usage: 'the base and the exponent' },
  rem: { element: 'rem', minArgs: 2, maxArgs: 2, argKind: 'numeric', usage: 'the dividend and the divisor' },
  min: { element: 'min', minArgs: 2, maxArgs: Infinity, argKind: 'numeric' },
  max: { element: 'max', minArgs: 2, maxArgs: Infinity, argKind: 'numeric' },
  abs: unary('abs'),
  exp: unary('exp'),
  ln: unary('ln'),
  floor: unary('floor'),
  ceiling: unary('ceiling'),
  ...Object.fromEntries(TRIG.map((name) => [name, unary(name)])),
  not: { element: 'not', minArgs: 1, maxArgs: 1, argKind: 'boolean' },
  xor: { element: 'xor', minArgs: 2, maxArgs: Infinity, argKind: 'boolean' },
}

/** Common names for functions that CellML spells differently. */
const DID_YOU_MEAN: Readonly<Record<string, string>> = {
  ceil: 'ceiling',
  log10: 'log(x, 10)',
  log2: 'log(x, 2)',
  diff: 'ode',
  pow: 'power',
  mod: 'rem',
  fabs: 'abs',
  asin: 'arcsin',
  acos: 'arccos',
  atan: 'arctan',
  asinh: 'arcsinh',
  acosh: 'arccosh',
  atanh: 'arctanh',
}

/** `table[key]`, ignoring inherited properties such as `toString`. */
export function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

export function unknownFunctionMessage(name: string): string {
  const suggestion =
    lookup(DID_YOU_MEAN, name) ?? Object.keys(FUNCTIONS).find((known) => known.toLowerCase() === name.toLowerCase())
  return `Unknown function '${name}'.` + (suggestion ? ` Did you mean '${suggestion}'?` : '')
}

export function argumentCountMessage(name: string, spec: FunctionSpec, got: number): string {
  let count: string
  if (spec.maxArgs === Infinity) count = `${spec.minArgs} or more arguments`
  else if (spec.minArgs === spec.maxArgs) count = `${spec.minArgs} argument${spec.minArgs === 1 ? '' : 's'}`
  else count = `${spec.minArgs} or ${spec.maxArgs} arguments`
  return `'${name}' takes ${count}${spec.usage ? ` (${spec.usage})` : ''}, got ${got}`
}

/** Constant names in text -> MathML element. These names cannot be used for variables. */
export const CONSTANTS: Readonly<Record<string, string>> = {
  pi: 'pi',
  e: 'exponentiale',
  inf: 'infinity',
  infinity: 'infinity',
  NaN: 'notanumber',
  true: 'true',
  false: 'false',
}

/** MathML constant element -> the name the generator prints. */
export const CONSTANT_TEXT: Readonly<Record<string, string>> = {
  pi: 'pi',
  exponentiale: 'e',
  infinity: 'inf',
  notanumber: 'NaN',
  true: 'true',
  false: 'false',
}

/** Words that can't be written as a variable name, because the parser reads them as something else. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(CONSTANTS),
  'def', 'model', 'comp', 'enddef', 'as', 'var', 'unit', 'sel', 'case', 'otherwise', 'endsel', 'and', 'or',
])

/**
 * Binding strength of the infix operators, loosest first. Anything not listed
 * (identifiers, numbers, function calls, `sel`) binds tightest.
 */
export const PRECEDENCE: Readonly<Record<string, number>> = {
  or: 10,
  and: 20,
  eq: 30,
  neq: 30,
  lt: 30,
  leq: 30,
  gt: 30,
  geq: 30,
  plus: 40,
  minus: 40,
  times: 50,
  divide: 50,
}
export const COMPARISON_PRECEDENCE = 30
/** Unary minus and plus: `-a * b` is (-a) * b. */
export const UNARY_PRECEDENCE = 60
export const ATOMIC_PRECEDENCE = 100

/** Operators whose chains the parser merges into one n-ary apply (`a + b + c`). */
export const FLATTENING_OPERATORS: ReadonlySet<string> = new Set(['plus', 'times', 'and', 'or'])

export function isCellMLIdentifier(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text)
}

/** A CellML basic real: the text of a plain <cn>, e.g. `-1`, `1.`, `.5`. */
export function isCellMLBasicReal(text: string): boolean {
  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(text)
}

/** A CellML integer: the exponent of an e-notation <cn>. */
export function isCellMLInteger(text: string): boolean {
  return /^[+-]?\d+$/.test(text)
}

/** A CellML real number string, which may have an exponent, e.g. an initial value of `1.5e-3`. */
export function isCellMLReal(text: string): boolean {
  return /^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)
}
