/**
 * Text that must parse, with the tree it must parse to (in sexpr spelling).
 * The guarantee test also runs every one of these through libcellml.
 */

const UNARY = [
  'abs', 'exp', 'ln', 'floor', 'ceiling',
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
  'arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot',
  'arcsinh', 'arccosh', 'arctanh', 'arcsech', 'arccsch', 'arccoth',
]

export interface Case {
  text: string
  tree: string
  /** What the generator prints for `tree`, when it isn't `text`. */
  printed?: string
}

/** One row per entry in the function table, plus the constants and number forms. */
export const FUNCTION_CASES: Case[] = [
  { text: 'sqrt(x)', tree: '(root x)' },
  { text: 'root(x, 3)', tree: '(root (degree 3) x)' },
  { text: 'log(x)', tree: '(log x)' },
  { text: 'log(x, 2)', tree: '(log (logbase 2) x)' },
  { text: 'ode(x, t)', tree: '(diff (bvar t) x)' },
  { text: 'ode(x, t, 2)', tree: '(diff (bvar t (degree 2)) x)' },
  { text: 'power(a, b)', tree: '(power a b)' },
  { text: 'rem(a, b)', tree: '(rem a b)' },
  { text: 'min(a, b)', tree: '(min a b)' },
  { text: 'min(a, b, c)', tree: '(min a b c)' },
  { text: 'max(a, b, c)', tree: '(max a b c)' },
  ...UNARY.map((f) => ({ text: `${f}(x)`, tree: `(${f} x)` })),
  { text: 'not(a > b)', tree: '(not (gt a b))' },
  { text: 'xor(a, b)', tree: '(xor a b)' },
  { text: 'xor(a < b, c or d)', tree: '(xor (lt a b) (or c d))' },
  { text: 'e', tree: '#exponentiale' },
  { text: 'inf', tree: '#infinity' },
  { text: 'infinity', tree: '#infinity', printed: 'inf' },
  { text: 'NaN', tree: '#notanumber' },
  { text: 'pi', tree: '#pi' },
  { text: 'true', tree: '#true' },
  { text: 'false', tree: '#false' },
  { text: '1e-3', tree: '1E-3' },
  { text: '1.5e+3 {mV}', tree: '1.5E+3{mV}' },
  { text: '.5', tree: '.5' },
  { text: '2.', tree: '2.' },
  { text: '3 {mV}', tree: '3{mV}' },
]

/** Brackets, precedence and the merging of chains. */
export const GROUPING_CASES: Case[] = [
  { text: 'a + b + c', tree: '(plus a b c)' },
  { text: '(a + b) + c', tree: '(plus (plus a b) c)' },
  { text: 'a + (b + c)', tree: '(plus a (plus b c))' },
  { text: 'a * b * c', tree: '(times a b c)' },
  { text: '(a * b) * c', tree: '(times (times a b) c)' },
  { text: 'a - b - c', tree: '(minus (minus a b) c)' },
  { text: 'a - (b - c)', tree: '(minus a (minus b c))' },
  { text: 'a * b + c', tree: '(plus (times a b) c)' },
  { text: '(a + b) * c', tree: '(times (plus a b) c)' },
  { text: '(a * b) + c', tree: '(plus (times a b) c)', printed: 'a * b + c' },
  { text: '-a * b', tree: '(times (minus a) b)' },
  { text: '-(a * b)', tree: '(minus (times a b))' },
  { text: 'a - -b', tree: '(minus a (minus b))' },
  { text: '+a', tree: '(plus a)' },
  { text: '+a + b', tree: '(plus (plus a) b)' },
  { text: 'a + +b', tree: '(plus a (plus b))' },
  { text: '+(a * b)', tree: '(plus (times a b))' },
  { text: 'sin(a + b) / 2', tree: '(divide (sin (plus a b)) 2)' },
  {
    text: 'sel case a > b and c < d or f == g: 1; otherwise: 0; endsel',
    tree: '(piecewise (piece 1 (or (and (gt a b) (lt c d)) (eq f g))) (otherwise 0))',
    printed: 'sel\n  case (a > b and c < d) or f == g: 1;\n  otherwise: 0;\nendsel',
  },
  {
    text: 'sel case a > b and (c < d or f == g): 1; endsel',
    tree: '(piecewise (piece 1 (and (gt a b) (or (lt c d) (eq f g)))))',
    printed: 'sel\n  case a > b and (c < d or f == g): 1;\nendsel',
  },
  {
    text: 'sel case (a > b): 1; endsel',
    tree: '(piecewise (piece 1 (gt a b)))',
    printed: 'sel\n  case a > b: 1;\nendsel',
  },
  {
    text: 'sel case a and b and c: 1; endsel',
    tree: '(piecewise (piece 1 (and a b c)))',
    printed: 'sel\n  case a and b and c: 1;\nendsel',
  },
  {
    text: 'sel case (a and b) and c: 1; endsel',
    tree: '(piecewise (piece 1 (and (and a b) c)))',
    printed: 'sel\n  case (a and b) and c: 1;\nendsel',
  },
]

export const ALL_CASES = [...FUNCTION_CASES, ...GROUPING_CASES]
