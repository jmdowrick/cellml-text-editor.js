import fs from 'node:fs'
import { createRequire } from 'node:module'

import createLibCellML from 'libcellml.js'

import { CELLML_MATHML_ELEMENTS, CELLML_NS, MATHML_NS } from '../../CellMLMathML'
import type { VariableKind } from '../../CellMLVariableClassification'
import { unitsOf } from './mathml'

let instance: Promise<any> | null = null

/**
 * libcellml, loaded once per test file. The wasm is instantiated here so Emscripten never tries to fetch it
 * (0.7 ignores `wasmBinary`, and happy-dom's `window` makes it think it is in a browser).
 */
export function libcellml(): Promise<any> {
  const wasm = fs.readFileSync(createRequire(import.meta.url).resolve('libcellml.js/libcellml.wasm'))
  instance ??= createLibCellML({
    instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
      WebAssembly.instantiate(wasm, imports).then(({ instance, module }) => done(instance, module))
      return {}
    },
  })
  return instance
}

/** Converts a CellML 1.1 (or 2.0) model to CellML 2.0 text. */
export async function toCellML2(xml: string): Promise<string> {
  const lib = await libcellml()
  const parser = new lib.Parser(false)
  const printer = new lib.Printer()
  const model = parser.parseModel(xml)
  try {
    return printer.printModel(model, false)
  } finally {
    model.delete()
    parser.delete()
    printer.delete()
  }
}

const BUILT_IN_UNITS = new Set([
  'ampere', 'becquerel', 'candela', 'coulomb', 'dimensionless', 'farad', 'gram', 'gray', 'henry', 'hertz',
  'joule', 'katal', 'kelvin', 'kilogram', 'litre', 'lumen', 'lux', 'metre', 'mole', 'newton', 'ohm', 'pascal',
  'radian', 'second', 'siemens', 'sievert', 'steradian', 'tesla', 'volt', 'watt', 'weber',
])

/**
 * Everything wrong with the math in a CellML 2.0 document, as CellML sees it.
 *
 * All the <math> in `xml` is put in one component of a fresh model that declares
 * every variable and units it refers to, so any issue libcellml's Validator finds
 * is an issue with the math itself. It also checks what the Validator doesn't:
 * that every element is in the CellML subset and that <math> only holds equations.
 */
export async function mathIssues(xml: string): Promise<string[]> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) return ['The XML does not parse']

  const issues: string[] = []
  const maths = Array.from(doc.getElementsByTagNameNS(MATHML_NS, 'math'))
  const variables = new Set<string>()
  const units = new Set<string>()

  for (const math of maths) {
    for (const child of Array.from(math.children)) {
      if (child.localName !== 'apply' || child.firstElementChild?.localName !== 'eq') {
        issues.push(`<math> holds a <${child.localName}>, not an equation`)
      }
    }
    for (const el of Array.from(math.getElementsByTagName('*'))) {
      if (el.namespaceURI !== MATHML_NS || !CELLML_MATHML_ELEMENTS.has(el.localName)) {
        issues.push(`<${el.localName}> is not in the CellML 2.0 MathML subset`)
      }
      if (el.localName === 'ci') variables.add(el.textContent?.trim() ?? '')
      if (el.localName === 'cn') units.add(unitsOf(el) ?? '')
    }
  }

  const serializer = new XMLSerializer()
  const model =
    `<model xmlns="${CELLML_NS}" name="wrapper">` +
    [...units]
      .filter((u) => u && !BUILT_IN_UNITS.has(u))
      .map((u) => `<units name="${u}"/>`)
      .join('') +
    '<component name="c">' +
    [...variables].map((v) => `<variable name="${v}" units="dimensionless" interface="none"/>`).join('') +
    maths.map((m) => serializer.serializeToString(m)).join('') +
    '</component></model>'

  const lib = await libcellml()
  const parser = new lib.Parser(true)
  const validator = new lib.Validator()
  const parsed = parser.parseModel(model)
  try {
    for (let i = 0; i < parser.issueCount(); i++) issues.push(`Parser: ${parser.issue(i).description()}`)
    validator.validateModel(parsed)
    for (let i = 0; i < validator.issueCount(); i++) issues.push(`Validator: ${validator.issue(i).description()}`)
  } finally {
    parsed.delete()
    parser.delete()
    validator.delete()
  }
  return issues
}

const NUMERIC_LITERAL = /^-?[\d.]+([eE][+-]?\d+)?$/

const ANALYSER_KINDS: Record<string, VariableKind> = {
  VARIABLE_OF_INTEGRATION: 'voi',
  STATE: 'state',
  CONSTANT: 'constant',
  COMPUTED_CONSTANT: 'computed_constant',
  ALGEBRAIC_VARIABLE: 'algebraic',
  EXTERNAL_VARIABLE: 'external',
}

/**
 * libcellml's Analyser's kind for each variable of the first component, or null when the Analyser rejects the model.
 * `externals` are the variables to treat as inputs from elsewhere.
 *
 * Units and variable initial values are made self-contained first (every unit dimensionless, every initial value a
 * number), since a component taken out of its library refers to units and parameters that aren't there. Neither
 * changes how a variable is classified.
 */
export async function analyserKinds(xml: string, externals: Iterable<string>): Promise<Map<string, VariableKind> | null> {
  const lib = await libcellml()
  const parser = new lib.Parser(false)
  const analyser = new lib.Analyser()
  const model = parser.parseModel(xml)
  try {
    const component = model.componentByIndex(0)
    if (!component) return null
    for (let i = 0; i < component.variableCount(); i++) {
      const variable = component.variableByIndex(i)
      variable.setUnitsByName('dimensionless')
      if (variable.initialValue() && !NUMERIC_LITERAL.test(variable.initialValue())) variable.setInitialValueByString('0')
    }
    component.setMath(component.math().replace(/(cellml:units=)"[^"]*"/g, '$1"dimensionless"'))

    for (const name of externals) {
      const variable = component.variableByName(name)
      if (variable) analyser.addExternalVariableByVariable(variable)
    }
    analyser.analyseModel(model)
    const analysed = analyser.analyserModel()
    if (!analysed.isValid()) return null

    const typeNames = new Map(Object.entries(lib.AnalyserVariable.Type).map(([key, value]) => [value, key]))
    const kinds = new Map<string, VariableKind>()
    for (let i = 0; i < component.variableCount(); i++) {
      const variable = component.variableByIndex(i)
      const kind = ANALYSER_KINDS[typeNames.get(analysed.analyserVariable(variable)?.type()) as string]
      if (kind) kinds.set(variable.name(), kind)
    }
    return kinds
  } finally {
    model.delete()
    parser.delete()
    analyser.delete()
  }
}
