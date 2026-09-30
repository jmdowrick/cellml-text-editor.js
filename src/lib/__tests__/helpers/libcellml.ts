import fs from 'node:fs'
import { createRequire } from 'node:module'

import createLibCellML from 'libcellml.js'

import { CELLML_MATHML_ELEMENTS, CELLML_NS, MATHML_NS } from '../../CellMLMathML'
import { unitsOf } from './mathml'

let instance: Promise<any> | null = null

/**
 * libcellml, loaded once per test file. The wasm is instantiated here, so
 * Emscripten never tries to fetch it: under jsdom it sees a `window` and may
 * think it is in a browser.
 */
export function libcellml(): Promise<any> {
  const wasm = createRequire(import.meta.url).resolve('libcellml.js/libcellml.wasm')
  instance ??= createLibCellML({
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(fs.readFileSync(wasm), imports).then(({ instance }) => receive(instance))
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
