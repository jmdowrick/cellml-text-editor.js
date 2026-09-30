import { CellMLTextGenerator } from './CellMLTextGenerator'
import { CellMLTextParser, type ParserError } from './CellMLTextParser'
import { CellMLLatexGenerator } from './CellMLLatexGenerator'
import { detectRenames, renameIdentifier } from './CellMLRename'
import {
  analyzeModel,
  applyVariableDefinitions,
  referenceSequence,
  type ModelAnalysis,
  type VariableDefinition,
} from './CellMLVariableResolution'

const NUMERIC_LITERAL = /^-?[\d.]+([eE][+-]?\d+)?$/

/** One row of the "Referenced variables" panel. */
export interface SessionVariable {
  key: string
  name: string
  componentName: string
  /** For an initializer this is the state variable's units. */
  units: string
  initialValue: string
  role: 'state' | 'initializer' | 'reference'
  /** Initializers only: the state variable whose units they share. */
  unitsFrom?: string
}

/** Some uses of `from` were renamed to `to`; `uses` is how many are left. */
export interface PendingRename {
  from: string
  to: string
  uses: number
}

export interface SessionComponentGroup {
  componentName: string
  variables: SessionVariable[]
}

const EMPTY_ANALYSIS: ModelAnalysis = {
  componentName: '',
  declared: [],
  referenced: [],
  stateVariables: [],
  unresolved: [],
  assigned: [],
  voi: [],
  dependencies: [],
}

/**
 * Development harness state: the text, the XML built from it, and the variable
 * metadata that Simple Mode keeps outside the text.
 *
 * It exists to show how a host drives the editor library:
 *
 *   text --parse--> doc --applyVariableDefinitions--> doc --analyzeModel--> analysis
 *
 * Simple Mode text holds equations only. The model name is whatever the XML
 * already says, the component name is set separately (`setComponentName`), and
 * every variable declaration comes from `units` / `initials` below.
 */
export class CellMLModelSession {
  private generator = new CellMLTextGenerator({ simplified: false })
  private parser = new CellMLTextParser({ simplified: false })
  private latex = new CellMLLatexGenerator()
  private listeners = new Set<() => void>()

  private _xml = ''
  private _text = ''
  private _errors: ParserError[] = []
  /** What the loaded XML has that the text can't hold (line 0: they belong to the XML). */
  private _generatorErrors: ParserError[] = []
  private _simple = false
  private _componentName = ''
  private _analysis: ModelAnalysis = EMPTY_ANALYSIS
  private doc: XMLDocument | null = null
  /** The `<ci>` names of the last good parse, in order: what the next edit is compared against. */
  private references: string[] = []
  private _pendingRename: PendingRename | null = null

  // Variable metadata kept outside the text (Simple Mode).
  private units = new Map<string, string>()
  private initials = new Map<string, string>() // state variable -> number or companion variable name

  /** Bumped whenever the text was regenerated (load, mode switch) and the editor must be refilled. */
  public textRevision = 0

  // --- Subscriptions -------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    this.listeners.forEach((listener) => listener())
  }

  // --- Read model ----------------------------------------------------------

  get text() {
    return this._text
  }
  get xml() {
    return this._xml
  }
  get errors() {
    return [...this._generatorErrors, ...this._errors]
  }
  get simple() {
    return this._simple
  }
  /** Simple Mode with a component to manage. */
  get editable() {
    return this._simple && this._analysis.componentName !== ''
  }
  /** Read from the XML; the session never changes it. */
  get modelName() {
    return this.doc?.documentElement.getAttribute('name') ?? ''
  }
  get componentName() {
    return this._analysis.componentName || this._componentName
  }

  get components(): SessionComponentGroup[] {
    const analysis = this._analysis
    if (!analysis.componentName) return []

    const states = new Set(analysis.stateVariables)
    const companions = this.companionsOf(states)

    const names = [...new Set([...analysis.referenced, ...companions.keys()])].sort()
    const componentName = analysis.componentName

    return [
      {
        componentName,
        variables: names.map((name) => ({
          key: `${componentName}:${name}`,
          name,
          componentName,
          // An initializer is the same quantity as its state variable, so it has no units of its own.
          units: this.units.get(companions.get(name) ?? name) ?? '',
          initialValue: this.initials.get(name) ?? '',
          role: states.has(name) ? 'state' : companions.has(name) ? 'initializer' : 'reference',
          ...(companions.has(name) ? { unitsFrom: companions.get(name) } : {}),
        })),
      },
    ]
  }

  /** Variables that still need units. Initializers never do; they follow their state variable. */
  get missing(): string[] {
    return this.components
      .flatMap((g) => g.variables)
      .filter((v) => v.role !== 'initializer' && !v.units.trim())
      .map((v) => v.name)
  }
  get isComplete() {
    return this.editable && this.missing.length === 0
  }
  /** Simple Mode: a variable renamed in some places but not others, offered for renaming everywhere. */
  get pendingRename(): PendingRename | null {
    return this._pendingRename
  }

  // --- Editing -------------------------------------------------------------

  /** Loads a model. Its variables' units and initial values seed the panel. */
  setXml(xml: string) {
    this._xml = xml
    this.units.clear()
    this.initials.clear()
    this.references = []
    this._pendingRename = null

    const analysis = analyzeSafely(xml)
    for (const v of analysis.declared) {
      if (v.units) this.units.set(v.name, v.units)
      if (v.initialValue) this.initials.set(v.name, v.initialValue)
    }
    this._componentName = analysis.componentName
    // Initializers share their state variable's units; drop any of their own.
    for (const companion of this.companionsOf(new Set(analysis.stateVariables)).keys()) this.units.delete(companion)

    this.regenerateText()
    this.rebuild()
  }

  /** Called with the editor's text (already debounced by the caller). */
  setText(text: string) {
    this._text = text
    this.rebuild()
  }

  setMode({ simple }: { simple: boolean }) {
    if (simple === this._simple) return
    this._simple = simple
    this._pendingRename = null
    this.generator.simplified = simple
    this.parser.simplified = simple
    this.regenerateText()
    this.rebuild()
  }

  /** Simple Mode: renames the component. Advanced Mode owns the name in the text. */
  setComponentName(name: string) {
    const cleaned = name.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '')
    if (!cleaned || cleaned === this._componentName) return
    this._componentName = cleaned
    this.rebuild()
  }

  setUnits(_componentName: string, variableName: string, units: string) {
    if (this.companionsOf(new Set(this._analysis.stateVariables)).has(variableName)) return // set on the state variable
    if (units.trim()) this.units.set(variableName, units.trim())
    else this.units.delete(variableName)
    this.rebuild()
  }

  setInitialValue(_componentName: string, variableName: string, value: string) {
    if (value.trim()) this.initials.set(variableName, value.trim())
    else this.initials.delete(variableName)
    this.rebuild()
  }

  /** Renames the pending variable in the rest of the text. `to` already has its units and initial value. */
  renameEverywhere() {
    const pending = this._pendingRename
    if (!pending) return
    this._pendingRename = null
    this._text = renameIdentifier(this._text, pending.from, pending.to)
    this.textRevision++
    this.units.delete(pending.from)
    this.initials.delete(pending.from)
    this.rebuild()
  }

  /** Keeps the pending rename's two names as separate variables. */
  dismissRename() {
    if (!this._pendingRename) return
    this._pendingRename = null
    this.notify()
  }

  /** LaTeX for the equation on a given text line, or '' when there isn't one. */
  latexAtLine(line: number): string {
    if (!this.doc) return ''

    for (const apply of Array.from(this.doc.getElementsByTagNameNS('*', 'apply'))) {
      const location = apply.getAttribute('data-source-location')
      if (!location) continue

      const [startText, endText] = location.split('-')
      const start = parseInt(startText || '0', 10)
      const end = endText ? parseInt(endText, 10) : start

      if (start > line) break
      if (line >= start && line <= end) return this.latex.convert(apply)
    }
    return ''
  }

  // --- Internals -----------------------------------------------------------

  private regenerateText() {
    const result = this._xml ? this.generator.generateResult(this._xml) : { text: '', errors: [] }
    this._text = result.text
    this._generatorErrors = result.errors.map((e) => ({
      line: 0,
      message: e.path ? `${e.message} (at ${e.path})` : e.message,
    }))
    this.textRevision++
  }

  /** companion variable name -> the state variable it initialises (only when the initial value names a variable). */
  private companionsOf(states: Iterable<string>): Map<string, string> {
    const companions = new Map<string, string>()
    for (const state of states) {
      const initial = this.initials.get(state)
      if (initial && !NUMERIC_LITERAL.test(initial)) companions.set(initial, state)
    }
    return companions
  }

  private definitions(states: string[]): VariableDefinition[] {
    const companions = this.companionsOf(states)
    const definitions: VariableDefinition[] = []

    for (const [name, units] of this.units) {
      if (companions.has(name)) continue
      definitions.push({ name, units, interface: 'public', initialValue: this.initials.get(name) })
    }
    for (const [companion, state] of companions) {
      const units = this.units.get(state)
      if (units) definitions.push({ name: companion, units, interface: 'public' })
    }
    return definitions
  }

  /**
   * Simple Mode: a variable renamed in the equations keeps its units and initial value. Renamed
   * everywhere, they move to the new name; renamed in some places, the new name gets a copy and the
   * rest are offered for renaming too. A name that was already in use keeps its own.
   */
  private carryRenames(after: string[]) {
    const before = new Set(this.references)

    for (const { from, to } of detectRenames(this.references, after)) {
      if (before.has(to) || this.units.has(to) || this.initials.has(to)) continue

      const units = this.units.get(from)
      const initial = this.initials.get(from)
      if (units) this.units.set(to, units)
      if (initial) this.initials.set(to, initial)

      const uses = after.filter((name) => name === from).length
      if (uses === 0) {
        this.units.delete(from)
        this.initials.delete(from)
        // Still typing the new name: follow it.
        if (this._pendingRename?.to === from) this._pendingRename = { ...this._pendingRename, to }
        else if (this._pendingRename?.from === from) this._pendingRename = null
      } else {
        this._pendingRename = { from, to, uses }
      }
    }
  }

  private rebuild() {
    const result = this.parser.parse(this._text, {
      baseXml: this._xml,
      componentName: this._componentName || undefined,
      finalise: this._simple
        ? (doc) => {
            this.carryRenames(referenceSequence(doc))
            applyVariableDefinitions(doc, this.definitions(analyzeModel(doc).stateVariables))
          }
        : undefined,
    })

    this._errors = result.errors

    if (result.xml && result.doc) {
      this._xml = result.xml
      this.doc = result.doc
      this._analysis = analyzeModel(result.doc)
      this.references = referenceSequence(result.doc)
      // Advanced Mode: the text names the component.
      if (!this._simple && this._analysis.componentName) this._componentName = this._analysis.componentName

      const pending = this._pendingRename
      if (pending) {
        const uses = this.references.filter((name) => name === pending.from).length
        if (uses === 0 || !this.references.includes(pending.to)) this._pendingRename = null
        else if (uses !== pending.uses) this._pendingRename = { ...pending, uses }
      }
    }

    this.notify()
  }
}

function analyzeSafely(xml: string): ModelAnalysis {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    return doc.querySelector('parsererror') ? EMPTY_ANALYSIS : analyzeModel(doc)
  } catch {
    return EMPTY_ANALYSIS
  }
}
