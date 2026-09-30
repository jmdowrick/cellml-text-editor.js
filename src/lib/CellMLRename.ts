import { CellMLTextScanner, TokenType } from './CellMLTextScanner'

export interface VariableRename {
  from: string
  to: string
}

/**
 * Variables renamed between two versions of the math, given each version's `<ci>` names in document
 * order (repeats included, see `referenceSequence`).
 *
 * The sequences are aligned, so other terms added or removed in the same edit don't hide a rename.
 * A run of names removed where a run of the same length was inserted is a substitution, paired by
 * position. A name substituted by two different names (or the reverse) is ambiguous and left out.
 */
export function detectRenames(before: string[], after: string[]): VariableRename[] {
  // Only the changed middle needs aligning.
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++
  }
  const a = before.slice(head, before.length - tail)
  const b = after.slice(head, after.length - tail)

  // lcs[i][j]: longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const targets = new Map<string, Set<string>>()
  const sources = new Map<string, Set<string>>()
  let removed: string[] = []
  let inserted: string[] = []

  const closeHunk = () => {
    if (removed.length === inserted.length) {
      removed.forEach((from, k) => {
        const to = inserted[k] as string
        if (from === to) return
        if (!targets.has(from)) targets.set(from, new Set())
        if (!sources.has(to)) sources.set(to, new Set())
        targets.get(from)!.add(to)
        sources.get(to)!.add(from)
      })
    }
    removed = []
    inserted = []
  }

  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      closeHunk()
      i++
      j++
    } else if (j >= b.length || (i < a.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      removed.push(a[i++] as string)
    } else {
      inserted.push(b[j++] as string)
    }
  }
  closeHunk()

  const renames: VariableRename[] = []
  for (const [from, tos] of targets) {
    const to = [...tos][0] as string
    if (tos.size === 1 && sources.get(to)?.size === 1) renames.push({ from, to })
  }
  return renames
}

/**
 * Simple Mode equation text with every use of the variable `from` renamed to `to`. Formatting and
 * comments are kept. Function names (`from(...)`) and units annotations (`{from}`) are not variables,
 * so they are left alone.
 */
export function renameIdentifier(text: string, from: string, to: string): string {
  const scanner = new CellMLTextScanner(text)
  const tokens: Array<{ type: TokenType; value: string; start: number; end: number }> = []
  while (scanner.token !== TokenType.EOF) {
    tokens.push({ type: scanner.token, value: scanner.value, start: scanner.start, end: scanner.end })
    scanner.nextToken()
  }

  const spans: Array<[number, number]> = []
  let braceDepth = 0
  tokens.forEach((token, k) => {
    if (token.type === TokenType.LBrace) braceDepth++
    else if (token.type === TokenType.RBrace) braceDepth = Math.max(0, braceDepth - 1)
    else if (
      token.type === TokenType.Identifier &&
      token.value === from &&
      braceDepth === 0 &&
      tokens[k + 1]?.type !== TokenType.LParam
    ) {
      spans.push([token.start, token.end])
    }
  })

  let result = text
  for (const [start, end] of spans.reverse()) result = result.slice(0, start) + to + result.slice(end)
  return result
}
