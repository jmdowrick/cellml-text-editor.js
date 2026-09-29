/** Seeded random MathML trees and token soups, so failures are reproducible. */

/** mulberry32: a small, fast, seedable PRNG. */
export function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const UNARY = ['abs', 'exp', 'ln', 'floor', 'ceiling', 'sin', 'cos', 'tanh', 'arcsinh', 'sech', 'arccot']
const COMPARISONS = ['eq', 'neq', 'lt', 'leq', 'gt', 'geq']

/** Random trees in sexpr spelling (see fromSexpr), typed so conditions only appear where CellML expects them. */
export function randomTrees(seed: number, count: number, maxDepth = 4): string[] {
  const next = random(seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
  const several = (min: number, max: number, make: () => string) =>
    Array.from({ length: min + Math.floor(next() * (max - min + 1)) }, make).join(' ')

  function numeric(depth: number): string {
    if (depth <= 0 || next() < 0.2) {
      return pick(['a', 'b', 'x', 't', 'v_1', '1', '2.5', '.5', '3E-2', '1.5E+4', '4{mV}', '#pi', '#exponentiale', '#infinity', '#notanumber'])
    }
    const n = () => numeric(depth - 1)
    const kind = pick([
      'plus', 'plus', 'minus', 'minus1', 'times', 'times', 'divide', 'power', 'rem', 'minmax', 'unary', 'sqrt',
      'root', 'log', 'logbase', 'diff', 'diff2', 'piecewise', 'plus1',
    ])
    switch (kind) {
      case 'plus':
      case 'times':
        return `(${kind} ${several(2, 3, n)})`
      case 'minus':
      case 'divide':
      case 'power':
      case 'rem':
        return `(${kind} ${n()} ${n()})`
      case 'minus1':
        return `(minus ${n()})`
      case 'plus1':
        return `(plus ${n()})`
      case 'minmax':
        return `(${pick(['min', 'max'])} ${several(2, 3, n)})`
      case 'unary':
        return `(${pick(UNARY)} ${n()})`
      case 'sqrt':
        return `(root ${n()})`
      case 'root':
        return `(root (degree ${n()}) ${n()})`
      case 'log':
        return `(log ${n()})`
      case 'logbase':
        return `(log (logbase ${n()}) ${n()})`
      case 'diff':
        return `(diff (bvar t) ${pick(['x', 'v_1'])})`
      case 'diff2':
        return `(diff (bvar t (degree 2)) x)`
      default: {
        const pieces = several(1, 2, () => `(piece ${n()} ${condition(depth - 1)})`)
        return `(piecewise ${pieces}${next() < 0.5 ? ` (otherwise ${n()})` : ''})`
      }
    }
  }

  function condition(depth: number): string {
    if (depth <= 0 || next() < 0.3) {
      return next() < 0.15 ? pick(['#true', '#false']) : `(${pick(COMPARISONS)} ${numeric(depth - 1)} ${numeric(depth - 1)})`
    }
    const c = () => condition(depth - 1)
    switch (pick(['and', 'or', 'not', 'xor', 'compare'])) {
      case 'and':
        return `(and ${several(2, 3, c)})`
      case 'or':
        return `(or ${several(2, 3, c)})`
      case 'not':
        return `(not ${c()})`
      case 'xor':
        return `(xor ${c()} ${c()})`
      default:
        return `(${pick(COMPARISONS)} ${numeric(depth - 1)} ${numeric(depth - 1)})`
    }
  }

  return Array.from({ length: count }, () => numeric(maxDepth))
}

const TOKENS = [
  'a', 'b', 'x', 't', 'e', 'pi', 'inf', 'true', '1', '2.5', '1e-3', '2e', '0', '.5',
  'sqrt', 'root', 'log', 'ode', 'sin', 'min', 'not', 'xor', 'power', 'ceil', 'foo', 'diff', 'mode',
  '+', '-', '*', '/', '(', ')', '(', ')', ',', ',', '{mV}', '{', '}', '==', '<', '>=', 'and', 'or',
  'sel', 'case', 'otherwise', 'endsel', ':', ';',
]

/** Random token sequences for `y = …;`. Most don't parse; the ones that do must be valid CellML. */
export function randomTokenSoups(seed: number, count: number): string[] {
  const next = random(seed)
  return Array.from({ length: count }, () =>
    Array.from({ length: 1 + Math.floor(next() * 10) }, () => TOKENS[Math.floor(next() * TOKENS.length)]).join(' '),
  )
}
