const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
const CELLML_2_0_NS = 'http://www.cellml.org/cellml/2.0#'

const NUMERIC_LITERAL = /^-?[\d.]+([eE][+-]?\d+)?$/

export type VariableInterface = 'public' | 'private' | 'public_and_private' | 'none'

/** How the host wants one variable declared. */
export interface VariableDefinition {
  name: string
  units: string
  interface?: VariableInterface
  /** A numeric literal, or the name of another defined variable (e.g. a state variable's `_init` companion). */
  initialValue?: string
}

/** A `<variable>` as declared in the XML. `interface` is the CellML interface attribute, verbatim. */
export interface DeclaredVariable {
  name: string
  units: string
  interface: string
  /** The initial_value attribute: a number, or the name of another variable. Empty when absent. */
  initialValue: string
}

export interface ModelAnalysis {
  /** Name of the component; empty when the document has none. */
  componentName: string
  /** Every variable the component declares, in document order (including ones the math never uses). */
  declared: DeclaredVariable[]
  /** Every variable used in the component's math, in order of first appearance. */
  referenced: string[]
  /** Variables that are the dependent term of a `<diff>` (i.e. the ODE state variables). */
  stateVariables: string[]
  /** Variables used in the math that have no declared units. */
  unresolved: string[]
}

function firstComponent(doc: XMLDocument | Document): Element | undefined {
  return doc.getElementsByTagName('component')[0]
}

// --- Analysis -------------------------------------------------------------

export function analyzeModel(doc: XMLDocument | Document): ModelAnalysis {
  const component = firstComponent(doc)
  if (!component) {
    return { componentName: '', declared: [], referenced: [], stateVariables: [], unresolved: [] }
  }

  const declared: DeclaredVariable[] = []
  const declaredEls = component.getElementsByTagName('variable')
  for (let i = 0; i < declaredEls.length; i++) {
    const el = declaredEls[i]
    const name = el?.getAttribute('name')
    if (!el || !name) continue
    declared.push({
      name,
      units: el.getAttribute('units') ?? '',
      interface: el.getAttribute('interface') ?? '',
      initialValue: el.getAttribute('initial_value') ?? '',
    })
  }
  const declaredUnits = new Map(declared.map((d) => [d.name, d.units]))

  const referenced = new Set<string>()
  const stateVariables = new Set<string>()
  const maths = component.getElementsByTagNameNS(MATHML_NS, 'math')
  for (let i = 0; i < maths.length; i++) {
    collectFromMath(maths[i], referenced, stateVariables)
  }

  return {
    componentName: component.getAttribute('name') ?? '',
    declared,
    referenced: Array.from(referenced),
    stateVariables: Array.from(stateVariables),
    unresolved: Array.from(referenced).filter((name) => !declaredUnits.get(name)),
  }
}

/** analyzeModel() for a CellML XML string. Returns null when the string isn't well-formed XML. */
export function analyzeModelXml(xml: string): ModelAnalysis | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) return null
  return analyzeModel(doc)
}

function collectFromMath(math: Element | null | undefined, referenced: Set<string>, stateVariables: Set<string>) {
  if (!math) return

  const cis = math.getElementsByTagNameNS(MATHML_NS, 'ci')
  for (let i = 0; i < cis.length; i++) {
    const name = cis[i]?.textContent?.trim()
    if (name) referenced.add(name)
  }

  const applies = math.getElementsByTagNameNS(MATHML_NS, 'apply')
  for (let i = 0; i < applies.length; i++) {
    const apply = applies[i]
    if (!apply || apply.firstElementChild?.localName !== 'diff') continue

    // <apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply> -> dependent is "V"
    const dependent = Array.from(apply.children).find((c) => c.localName !== 'diff' && c.localName !== 'bvar')
    const name = dependent?.localName === 'ci' ? dependent.textContent?.trim() : undefined
    if (name) stateVariables.add(name)
  }
}

// --- Applying definitions -------------------------------------------------

export function applyVariableDefinitions(doc: XMLDocument | Document, definitions: VariableDefinition[]): void {
  const component = firstComponent(doc)
  if (!component) return

  const byName = new Map(definitions.map((d) => [d.name, d]))
  const mathEl = component.getElementsByTagNameNS(MATHML_NS, 'math')[0]
  const existing = new Map(
    Array.from(component.getElementsByTagName('variable')).map((v) => [v.getAttribute('name') ?? '', v]),
  )

  const queue = analyzeModel(doc).referenced
  const seen = new Set<string>()

  while (queue.length > 0) {
    const name = queue.shift() as string
    if (seen.has(name)) continue
    seen.add(name)

    const definition = byName.get(name)
    if (!definition) continue

    writeDefinition(doc, component, mathEl, existing, definition)

    if (definition.initialValue && !NUMERIC_LITERAL.test(definition.initialValue)) {
      queue.push(definition.initialValue)
    }
  }
}

function writeDefinition(
  doc: XMLDocument | Document,
  component: Element,
  mathEl: Element | undefined,
  existing: Map<string, Element>,
  definition: VariableDefinition,
) {
  let variable = existing.get(definition.name)

  if (!variable) {
    variable = doc.createElementNS(CELLML_2_0_NS, 'variable')
    variable.setAttribute('name', definition.name)
    // Declarations conventionally precede the math.
    if (mathEl && mathEl.parentNode === component) {
      component.insertBefore(variable, mathEl)
    } else {
      component.appendChild(variable)
    }
    existing.set(definition.name, variable)
  }

  variable.setAttribute('units', definition.units)

  if (definition.initialValue) {
    variable.setAttribute('initial_value', definition.initialValue)
  } else {
    variable.removeAttribute('initial_value')
  }

  if (definition.interface) {
    variable.setAttribute('interface', definition.interface)
  }
}
