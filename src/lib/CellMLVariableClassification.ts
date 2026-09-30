import type { ModelAnalysis } from './CellMLVariableResolution'

/**
 * What a variable is in the model. The names mirror libcellml's `AnalyserVariable.Type`, but unlike libcellml's
 * Analyser this works on an incomplete component too: undeclared names, missing initial values and unconnected
 * inputs still get a kind.
 */
export type VariableKind = 'voi' | 'state' | 'constant' | 'computed_constant' | 'algebraic' | 'external'

/** Whether a variable of this kind can initialise another (e.g. be a state variable's initial value). */
export function isInitialisingKind(kind?: VariableKind): boolean {
  return kind === 'constant' || kind === 'computed_constant'
}

/**
 * Classifies every declared or referenced variable, in that order.
 *
 * - `voi` / `state`: inside a `<bvar>` / the dependent term of a `<diff>`.
 * - A variable an equation defines explicitly (`x = ...`) is `computed_constant` when it has exactly one definition
 *   and everything that definition uses is a constant or computed constant, else `algebraic` (so is every variable
 *   in a cycle).
 * - `constant`: in `options.constants`, or by default a declared variable with an initial value. This includes one on
 *   the left of an implicit equation: in `a + k = 5`, `k` stays a constant and the equation determines `a`.
 * - `algebraic`: any other variable on the left of an implicit equation.
 * - `external`: anything else, i.e. an input from elsewhere or a name with no declaration.
 */
export function classifyVariables(
  analysis: ModelAnalysis,
  options: { constants?: Iterable<string> } = {},
): Map<string, VariableKind> {
  const voi = new Set(analysis.voi)
  const states = new Set(analysis.stateVariables)
  const assigned = new Set(analysis.assigned)
  const constants = new Set(
    options.constants ?? analysis.declared.filter((d) => d.initialValue).map((d) => d.name),
  )

  // A definition's own name isn't a dependency: libcellml treats "x = x + 1" like "x = 1".
  const definitions = new Map<string, string[][]>()
  for (const { target, uses } of analysis.dependencies) {
    if (target === null) continue
    const list = definitions.get(target) ?? []
    list.push(uses.filter((name) => name !== target))
    definitions.set(target, list)
  }

  const kinds = new Map<string, VariableKind>()
  const visiting = new Set<string>()

  const kindOf = (name: string): VariableKind => {
    const known = kinds.get(name)
    if (known) return known
    // Back on the stack: `name` is in a cycle, and so is everything between here and there.
    if (visiting.has(name)) return 'algebraic'

    let kind: VariableKind
    if (voi.has(name)) {
      kind = 'voi'
    } else if (states.has(name)) {
      kind = 'state'
    } else if (definitions.has(name)) {
      const defs = definitions.get(name)!
      visiting.add(name)
      const constant = defs.length === 1 && defs[0]!.every((use) => isInitialisingKind(kindOf(use)))
      visiting.delete(name)
      kind = constant ? 'computed_constant' : 'algebraic'
    } else if (constants.has(name)) {
      kind = 'constant'
    } else if (assigned.has(name)) {
      kind = 'algebraic'
    } else {
      kind = 'external'
    }
    kinds.set(name, kind)
    return kind
  }

  const result = new Map<string, VariableKind>()
  for (const name of [...analysis.declared.map((d) => d.name), ...analysis.referenced]) {
    if (!result.has(name)) result.set(name, kindOf(name))
  }
  return result
}
