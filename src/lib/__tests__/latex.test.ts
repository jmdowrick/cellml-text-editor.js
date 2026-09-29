import { expect, test } from 'vitest'

import { CellMLLatexGenerator } from '../CellMLLatexGenerator'
import { modelWithRhs } from './helpers/mathml'

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
