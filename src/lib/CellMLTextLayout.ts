/**
 * The layout sidecar: everything about a CellML Text file that the CellML can't
 * hold — comments, blank lines, how each statement was written (line breaks,
 * spacing, extra brackets) and the order of `var` lines among the equations.
 *
 * The parser records a layout from the text; the generator takes one back and
 * writes each statement as it was typed, as long as its math still matches the
 * CellML. A layout never changes meaning: the generator re-checks every
 * statement's text against the XML before it uses it.
 *
 * Units come from the XML, never from the layout: it keeps only the comments
 * around a `def unit` block.
 *
 * Normal form. Text survives parse -> generate exactly when it is in normal form:
 * `\n` line endings, no trailing whitespace, the generator's `def … as` and
 * `enddef;` lines, one statement per line, no stray `;`, comments at least as
 * indented as the item that follows them (at the body indent before an
 * `enddef;`), and one final newline. Any other text reaches normal form after one
 * round trip, keeping every comment.
 */

export const LAYOUT_FORMAT = 'cellml-text-layout'
export const LAYOUT_VERSION = 1

/** Lines that are blank ('') or a comment ('<spaces>// …'), indented relative to what follows them. */
export type TriviaLines = string[]

export interface LayoutItem {
  /** The comment and blank lines before the item. */
  leading: TriviaLines
  /** A comment on the item's last line, with the spaces before it, e.g. '   // mV'. */
  trailing?: string
}

export interface StatementLayout extends LayoutItem {
  kind: 'eq' | 'var'
  /** The statement as typed, from its first token to its ';'. Later lines are relative to the first. */
  text: string
}

export interface ComponentLayout extends LayoutItem {
  /** `trailing` is the comment after `def comp NAME as`. */
  name: string
  statements: StatementLayout[]
  /** Before the component's `enddef;` (or the end of Simple Mode text), relative to the body indent. */
  footer: TriviaLines
  /** After the component's `enddef;`. */
  endTrailing?: string
}

/**
 * The comments around a `def unit` block. The text doesn't hold units (they come
 * from the XML), so only the comments are kept, and any inside the block move above it.
 */
export interface UnitsLayout extends LayoutItem {
  kind: 'units'
  name: string
}

export interface ComponentRef {
  kind: 'comp'
  name: string
}

/** Advanced Mode text only. `leading` is before `def model`, `trailing` after its `as`. */
export interface ModelLayout extends LayoutItem {
  /** Units blocks and components, in the order they were written. */
  blocks: Array<ComponentRef | UnitsLayout>
  /** Before the model's `enddef;`, relative to the body indent. */
  footer: TriviaLines
  endTrailing?: string
  /** After the model's `enddef;`. */
  after: TriviaLines
}

export interface TextLayout {
  format: typeof LAYOUT_FORMAT
  version: typeof LAYOUT_VERSION
  /** Absent for Simple Mode text, which has no model or component lines. */
  model?: ModelLayout
  components: ComponentLayout[]
}

/** Where the parser found each part of the text (offsets into the source). */
export type LayoutAnchor =
  | { kind: 'model-open' | 'model-close' | 'comp-close' | 'eq' | 'var'; start: number; end: number }
  | { kind: 'comp-open' | 'units'; start: number; end: number; name: string }

// --- Lines -------------------------------------------------------------------

const COMMENT = /\/\/[^\n]*/g

/** The `//` comments in some text. The language has no strings, so `//` always starts one. */
export function commentsIn(text: string): string[] {
  return (text.match(COMMENT) ?? []).map((c) => c.trimEnd())
}

export function isTriviaLine(line: string): boolean {
  return /^( *\/\/[^\n]*)?$/.test(line) && line === line.trimEnd()
}

export function isTrailing(text: string): boolean {
  return /^[ \t]*\/\/[^\n]*$/.test(text) && text === text.trimEnd()
}

/** Leading tabs as two spaces, and no carriage returns. */
function tidy(line: string): string {
  return line.replace(/\r/g, '').replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '  '))
}

function indentOf(line: string): number {
  return line.match(/^ */)![0].length
}

/** Removes up to `count` leading spaces. */
function dedent(line: string, count: number): string {
  return line.slice(Math.min(count, indentOf(line)))
}

/** A line between statements: its comment, or '' when it has none. Stray `;`s are dropped. */
function triviaLine(raw: string): string {
  const line = tidy(raw)
  const at = line.indexOf('//')
  if (at < 0) return ''
  // Anything before the comment (stray `;`) becomes a space, so the comment stays in its column.
  return (line.slice(0, at).replace(/[^ ]/g, ' ') + line.slice(at)).trimEnd()
}

/** Dedents lines together, so the least indented comment is at the base indent. */
function dedentBlock(lines: string[]): string[] {
  const indents = lines.filter((l) => l !== '').map(indentOf)
  const least = indents.length ? Math.min(...indents) : 0
  return lines.map((l) => (l === '' ? '' : l.slice(least)))
}

function dropTrailingBlanks(lines: string[]): string[] {
  const out = [...lines]
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

/** Indents every non-empty line of `text`. */
export function indentText(text: string, indent: string): string[] {
  return text.split('\n').map((l) => (l === '' ? '' : indent + l))
}

// --- Recording -----------------------------------------------------------------

/**
 * Builds the layout of `source` from where the parser found each part of it.
 * `componentName` is the component Simple Mode text belongs to.
 */
export function buildLayout(source: string, anchors: LayoutAnchor[], componentName: string): TextLayout {
  const column = (offset: number) => {
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1
    return indentOf(tidy(source.slice(lineStart, offset)))
  }

  /** The gap before anchor i: the trailing comment of the one before, and the lines leading up to this one. */
  const gap = (i: number): { tail: string; lines: string[] } => {
    const from = i === 0 ? 0 : anchors[i - 1]!.end
    const to = i < anchors.length ? anchors[i]!.start : source.length
    const parts = source.slice(from, to).split('\n')
    const tail = i === 0 ? '' : parts.shift()!
    // The last part is the start of the next anchor's own line, unless there is no next anchor.
    if (i < anchors.length) parts.pop()
    return { tail, lines: parts.map(triviaLine) }
  }

  const leads: string[][] = []
  const trails: Array<string | undefined> = []
  for (let i = 0; i <= anchors.length; i++) {
    const { tail, lines } = gap(i)
    if (i > 0) {
      const comment = triviaLine(tail)
      trails[i - 1] = comment ? comment : undefined
    }
    leads[i] = lines
  }

  /** The anchor's leading lines, relative to its column, plus any comments inside a part the generator rewrites. */
  const leadingOf = (i: number, rewritten = false): string[] => {
    const anchor = anchors[i]!
    const lines = leads[i]!.map((l) => dedent(l, column(anchor.start)))
    return rewritten ? [...lines, ...commentsIn(source.slice(anchor.start, anchor.end))] : lines
  }

  const verbatim = (i: number): string => {
    const anchor = anchors[i]!
    const col = column(anchor.start)
    const [first = '', ...rest] = source.slice(anchor.start, anchor.end).split('\n')
    return [first.replace(/\r/g, '').trimEnd(), ...rest.map((l) => dedent(tidy(l).trimEnd(), col))].join('\n')
  }

  const withTrailing = <T extends object>(item: T, i: number): T => {
    const trailing = trails[i]
    return trailing === undefined ? item : { ...item, trailing }
  }

  const statement = (i: number): StatementLayout =>
    withTrailing({ kind: anchors[i]!.kind as 'eq' | 'var', leading: leadingOf(i), text: verbatim(i) }, i)

  const last = dropTrailingBlanks(leads[anchors.length]!)

  if (anchors[0]?.kind !== 'model-open') {
    // Simple Mode: equations only.
    const statements = anchors.map((_, i) => statement(i))
    return {
      format: LAYOUT_FORMAT,
      version: LAYOUT_VERSION,
      components: [{ name: componentName, leading: [], statements, footer: dedentBlock(last) }],
    }
  }

  const components: ComponentLayout[] = []
  let model: ModelLayout = { leading: [], blocks: [], footer: [], after: [] }
  let current: ComponentLayout | null = null

  anchors.forEach((anchor, i) => {
    switch (anchor.kind) {
      case 'model-open':
        model = withTrailing({ ...model, leading: leadingOf(i, true) }, i)
        break
      case 'units':
        model.blocks.push(withTrailing({ kind: 'units', name: anchor.name, leading: leadingOf(i, true) }, i))
        break
      case 'comp-open':
        current = withTrailing({ name: anchor.name, leading: leadingOf(i, true), statements: [], footer: [] }, i)
        components.push(current)
        model.blocks.push({ kind: 'comp', name: anchor.name })
        break
      case 'eq':
      case 'var':
        current?.statements.push(statement(i))
        break
      case 'comp-close':
        if (current) {
          current.footer = dedentBlock(leadingOf(i, true))
          if (trails[i] !== undefined) current.endTrailing = trails[i]
        }
        current = null
        break
      case 'model-close':
        model.footer = dedentBlock(leadingOf(i, true))
        if (trails[i] !== undefined) model.endTrailing = trails[i]
        break
    }
  })
  model.after = last

  return { format: LAYOUT_FORMAT, version: LAYOUT_VERSION, model, components }
}

// --- Merging -------------------------------------------------------------------

/**
 * The layout after an edit in Simple Mode. Simple Mode text shows one component's
 * equations, so they (and its footer) replace that component's; its `var` lines,
 * which Simple Mode hides, are kept, each before the equation it came before.
 * The model's layout and the other components are kept too.
 */
export function mergeSimpleLayout(previous: TextLayout | null, simple: TextLayout): TextLayout {
  const edited = simple.components[0]
  if (!previous || !edited) return simple

  const index = Math.max(
    0,
    previous.components.findIndex((c) => c.name === edited.name),
  )
  const old = previous.components[index]
  if (!old) return { ...previous, components: [edited] }

  const equations = [...edited.statements]
  const oldEquations = old.statements.filter((s) => s.kind === 'eq')

  // Each old equation that is still there, unchanged: old index -> new index.
  const kept = new Map<number, number>()
  const used = new Set<number>()
  oldEquations.forEach((e, i) => {
    const j = equations.findIndex((n, k) => !used.has(k) && n.text === e.text)
    if (j >= 0) {
      kept.set(i, j)
      used.add(j)
    }
  })

  // A var goes before the same equation as before, if it is still there; otherwise at the same position.
  const placed: StatementLayout[][] = equations.map(() => [])
  const atEnd: StatementLayout[] = []
  let equationsBefore = 0
  for (const statement of old.statements) {
    if (statement.kind === 'eq') {
      equationsBefore++
      continue
    }
    const beforeAnEquation = equationsBefore < oldEquations.length
    const at = kept.get(equationsBefore) ?? (beforeAnEquation && equationsBefore < equations.length ? equationsBefore : -1)
    if (at < 0) atEnd.push(statement)
    else placed[at]!.push(statement)
  }

  // Simple Mode text never starts with a blank line; give the first equation back the ones it had.
  const first = equations[0]
  const oldFirst = oldEquations.findIndex((_, i) => kept.get(i) === 0)
  if (first && oldFirst >= 0) {
    const oldLeading = oldEquations[oldFirst]!.leading
    const blanks = oldLeading.findIndex((l) => l !== '')
    const count = blanks < 0 ? oldLeading.length : blanks
    if (count > 0 && JSON.stringify(oldLeading.slice(count)) === JSON.stringify(first.leading)) {
      equations[0] = { ...first, leading: oldLeading }
    }
  }

  const statements = [...equations.flatMap((e, j) => [...placed[j]!, e]), ...atEnd]
  const merged: ComponentLayout = { ...old, name: edited.name, statements, footer: edited.footer }
  const components = [...previous.components]
  components[index] = merged
  // Rename the model's reference too, so the component keeps its place.
  const model = previous.model && {
    ...previous.model,
    blocks: previous.model.blocks.map((b) => (b.kind === 'comp' && b.name === old.name ? { ...b, name: edited.name } : b)),
  }
  return { ...previous, ...(model ? { model } : {}), components }
}

// --- Serialising ---------------------------------------------------------------

export function serializeLayout(layout: TextLayout): string {
  return JSON.stringify(layout, null, 2) + '\n'
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Trivia as stored: lines that aren't blank or a comment are dropped, never trusted. */
function readTrivia(value: unknown): TriviaLines | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((l) => typeof l === 'string')) return null
  return value.map((l: string) => l.trimEnd()).filter(isTriviaLine)
}

function readItem(value: Record<string, unknown>): LayoutItem | null {
  const leading = readTrivia(value.leading)
  if (!leading) return null
  const item: LayoutItem = { leading }
  if (typeof value.trailing === 'string' && isTrailing(value.trailing)) item.trailing = value.trailing
  return item
}

function readStatement(value: unknown): StatementLayout | null {
  if (!isObject(value) || (value.kind !== 'eq' && value.kind !== 'var') || typeof value.text !== 'string') return null
  const item = readItem(value)
  return item && { kind: value.kind, ...item, text: value.text }
}

function readComponent(value: unknown): ComponentLayout | null {
  if (!isObject(value) || typeof value.name !== 'string' || !Array.isArray(value.statements)) return null
  const item = readItem(value)
  const footer = readTrivia(value.footer)
  const statements = value.statements.map(readStatement)
  if (!item || !footer || statements.some((s) => !s)) return null
  const component: ComponentLayout = { name: value.name, ...item, statements: statements as StatementLayout[], footer }
  if (typeof value.endTrailing === 'string' && isTrailing(value.endTrailing)) component.endTrailing = value.endTrailing
  return component
}

function readBlock(value: unknown): ComponentRef | UnitsLayout | null {
  if (!isObject(value) || typeof value.name !== 'string') return null
  if (value.kind === 'comp') return { kind: 'comp', name: value.name }
  if (value.kind !== 'units') return null
  const item = readItem(value)
  return item && { kind: 'units', name: value.name, ...item }
}

function readModel(value: unknown): ModelLayout | null {
  if (!isObject(value) || !Array.isArray(value.blocks)) return null
  const item = readItem(value)
  const footer = readTrivia(value.footer)
  const after = readTrivia(value.after)
  const blocks = value.blocks.map(readBlock)
  if (!item || !footer || !after || blocks.some((b) => !b)) return null
  const model: ModelLayout = { ...item, blocks: blocks as Array<ComponentRef | UnitsLayout>, footer, after }
  if (typeof value.endTrailing === 'string' && isTrailing(value.endTrailing)) model.endTrailing = value.endTrailing
  return model
}

/**
 * A layout read back from `serializeLayout` output, or null when the JSON isn't
 * a layout this version understands. Comment lines that aren't comments are
 * dropped; statement texts are checked by the generator when it uses them.
 */
export function parseLayout(json: string): TextLayout | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (!isObject(value) || value.format !== LAYOUT_FORMAT || value.version !== LAYOUT_VERSION) return null
  if (!Array.isArray(value.components)) return null

  const components = value.components.map(readComponent)
  if (components.some((c) => !c)) return null
  const layout: TextLayout = { format: LAYOUT_FORMAT, version: LAYOUT_VERSION, components: components as ComponentLayout[] }
  if (value.model !== undefined) {
    const model = readModel(value.model)
    if (!model) return null
    layout.model = model
  }
  return layout
}
