import { CellMLTextGenerator } from './CellMLTextGenerator'
import { CellMLTextParser, type ParserError } from './CellMLTextParser'
import { CellMLLatexGenerator } from './CellMLLatexGenerator'
import {
  analyzeModel,
  applyVariableDefinitions,
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
  private _simple = false
  private _componentName = ''
  private _analysis: ModelAnalysis = EMPTY_ANALYSIS
  private doc: XMLDocument | null = null

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
    return this._errors
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

  // --- Editing -------------------------------------------------------------

  /** Loads a model. Its variables' units and initial values seed the panel. */
  setXml(xml: string) {
    this._xml = xml
    this.units.clear()
    this.initials.clear()

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
    this._text = this._xml ? this.generator.generate(this._xml) : ''
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

  private rebuild() {
    const result = this.parser.parse(this._text, {
      baseXml: this._xml,
      componentName: this._componentName || undefined,
      finalise: this._simple
        ? (doc) => applyVariableDefinitions(doc, this.definitions(analyzeModel(doc).stateVariables))
        : undefined,
    })

    this._errors = result.errors

    if (result.xml && result.doc) {
      this._xml = result.xml
      this.doc = result.doc
      this._analysis = analyzeModel(result.doc)
      // Advanced Mode: the text names the component.
      if (!this._simple && this._analysis.componentName) this._componentName = this._analysis.componentName
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
