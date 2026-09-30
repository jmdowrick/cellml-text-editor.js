// @vitest-environment jsdom
// KaTeX warns about quirks mode under happy-dom, which has no document.compatMode.

import fs from 'node:fs'
import path from 'node:path'

import katex from 'katex'
import { expect, test } from 'vitest'

import { CellMLLatexGenerator, formatIdentifier } from '../CellMLLatexGenerator'
import { CORPUS_FILES } from './helpers/corpus'
import { modelWith, modelWithRhs } from './helpers/mathml'

function latex(tree: string): string {
  const doc = new DOMParser().parseFromString(modelWithRhs(tree), 'application/xml')
  return new CellMLLatexGenerator().convert(doc.getElementsByTagName('apply')[0]!)
}

test.each([
  ['(root x)', '\\sqrt{x}'],
  ['(root (degree 3) x)', '\\sqrt[3]{x}'],
  ['(log x)', '\\log\\left(x\\right)'],
  ['(log (logbase 2) x)', '\\log_{2}\\left(x\\right)'],
  ['(ceiling x)', '\\lceil x \\rceil'],
  ['(floor x)', '\\lfloor x \\rfloor'],
  ['(min a b c)', '\\min\\left(a, b, c\\right)'],
  ['(max a b)', '\\max\\left(a, b\\right)'],
  ['(diff (bvar t) x)', '\\frac{dx}{dt}'],
  ['(diff (bvar t (degree 2)) x)', '\\frac{d^{2}x}{dt^{2}}'],
  ['(sec x)', '\\sec\\left(x\\right)'],
  ['(arcsinh x)', '\\operatorname{arcsinh}\\left(x\\right)'],
  ['(rem a b)', '\\operatorname{rem}\\left(a, b\\right)'],
  ['#exponentiale', 'e'],
  ['#infinity', '\\infty'],
  ['#notanumber', '\\mathrm{NaN}'],
  ['(minus (plus a b))', '-\\left(a + b\\right)'],
  ['(piecewise (piece 1 (and (gt a b) #true)))', '\\begin{cases} 1 & \\text{if } a > b \\land \\mathrm{true} \\\\  \\end{cases}'],
])('%s', (tree, expected) => {
  expect(latex(tree)).toBe(`y = ${expected}`)
})

test('legacy <sqrt/>', () => {
  const doc = new DOMParser().parseFromString(
    '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>y</ci><apply><sqrt/><ci>x</ci></apply></apply></math>',
    'application/xml',
  )
  expect(new CellMLLatexGenerator().convert(doc.documentElement)).toBe('y = \\sqrt{x}')
})

// vue3-math-editor's "Copy as LaTeX" output for the same names.
const NAMES: [string, string][] = [
  ['V', 'V'],
  ['Vm', '\\mathit{Vm}'],
  ['V_m', 'V_{m}'],
  ['Vm_init', '\\mathit{Vm}_{\\mathit{init}}'],
  ['C_Ca_i', 'C_{\\mathit{Ca},i}'],
  ['x_a_12', 'x_{a,12}'],
  ['g_Kr__max', '{g_{\\mathit{Kr}}^{\\mathit{max}}}'],
  ['beta_n__inf', '{\\beta_{n}^{\\mathit{inf}}}'],
  ['k__max', '{k^{\\mathit{max}}}'],
  ['x__a__b', '{x^{a,b}}'],
  ['alpha_m', '\\alpha_{m}'],
  ['V_alpha', 'V_{\\alpha}'],
  ['tau2', '\\tau2'],
  ['x__tau2', '{x^{\\tau2}}'],
  ['Delta_q_us', '\\Delta_{q,\\mathit{us}}'],
  ['tau_m_Na1_6', '\\tau_{m,\\mathit{Na1},6}'],
  ['du_C_dt', '\\mathit{du}_{C,\\mathit{dt}}'],
  ['k_pi', 'k_{\\mathit{pi}}'],
  ['a___b', '\\mathit{a\\_\\_\\_b}'],
  ['V_', '\\mathit{V\\_}'],
  ['_x', '\\mathit{\\_x}'],
]

test.each(NAMES)('name %s', (name, expected) => {
  expect(formatIdentifier(name)).toBe(expected)
})

test.each([
  ['(power V_m 2)', '{V_{m}}^{2}'],
  ['(diff (bvar t) g_Kr__max)', '\\frac{d{g_{\\mathit{Kr}}^{\\mathit{max}}}}{dt}'],
])('name in %s', (tree, expected) => {
  expect(latex(tree)).toBe(`y = ${expected}`)
})

test('<ci> text is trimmed', () => {
  const doc = new DOMParser().parseFromString(
    modelWith('<apply><eq/><ci>\n  y  </ci><ci> V_m\n</ci></apply>'),
    'application/xml',
  )
  expect(new CellMLLatexGenerator().convert(doc.getElementsByTagName('apply')[0]!)).toBe('y = V_{m}')
})

/** Every distinct <ci> name in the bundled module libraries. */
function corpusNames(): string[] {
  const names = new Set<string>()
  for (const file of CORPUS_FILES) {
    const xml = fs.readFileSync(path.resolve(__dirname, '../../assets/cellml', file), 'utf8')
    for (const [, name] of xml.matchAll(/<ci\b[^>]*>([^<]*)<\/ci>/g)) names.add(name!.trim())
  }
  return [...names].sort()
}

test('KaTeX renders every name', () => {
  const names = [...NAMES.map(([name]) => name), ...corpusNames()]
  expect(names.length).toBeGreaterThan(1800)
  const failures = names.flatMap((name) => {
    try {
      katex.renderToString(formatIdentifier(name), { throwOnError: true })
      return []
    } catch (error) {
      return [`${name}: ${(error as Error).message}`]
    }
  })
  expect(failures).toEqual([])
})
