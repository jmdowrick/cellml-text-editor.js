import { describe, expect, test } from 'vitest'

import { CellMLTextGenerator } from '../CellMLTextGenerator'
import { ALL_CASES } from './helpers/fixtures'
import { equationsOf, fromSexpr, modelWith, modelWithRhs, parseSimple, rhs } from './helpers/mathml'

const generator = new CellMLTextGenerator({ simplified: true })

/** The text for `y = <tree>`, failing the test if anything was reported. */
function print(tree: string): string {
  const result = generator.generateResult(modelWithRhs(tree))
  expect(result.errors).toEqual([])
  const text = result.text.trimEnd()
  expect(text.startsWith('y = ') && text.endsWith(';')).toBe(true)
  return text.slice('y = '.length, -1)
}

function report(mathContent: string) {
  return generator.generateResult(modelWith(mathContent))
}

describe('MathML to text', () => {
  test.each(ALL_CASES)('$tree', ({ text, tree, printed }) => {
    const out = print(tree)
    expect(out).toBe(printed ?? text)
    expect(rhs(out)).toBe(tree)
  })

  test('legacy <sqrt/> is read, and rewritten as <root/>', () => {
    const text = generator.generateResult(modelWith('<apply><eq/><ci>y</ci><apply><sqrt/><ci>x</ci></apply></apply>'))
    expect(text).toEqual({ text: 'y = sqrt(x);\n', errors: [] })
    const { xml } = parseSimple(text.text)
    expect(xml).toContain('<root/>')
    expect(xml).not.toContain('sqrt')
  })

  test('Advanced Mode round trip', () => {
    const advanced = new CellMLTextGenerator({ simplified: false })
    const xml =
      '<model xmlns="http://www.cellml.org/cellml/2.0#" xmlns:cellml="http://www.cellml.org/cellml/2.0#" name="m">' +
      '<component name="c"><variable name="x" units="dimensionless" initial_value="1" interface="public"/>' +
      '<variable name="t" units="dimensionless" interface="public"/>' +
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/>' +
      fromSexpr('(diff (bvar t) x)') +
      fromSexpr('(root (degree 3) (plus x 1))') +
      '</apply></math></component></model>'
    const result = advanced.generateResult(xml)
    expect(result.errors).toEqual([])
    expect(result.text).toBe(`def model m as
  def comp c as
    var x: dimensionless {init: 1, interface: public};
    var t: dimensionless {interface: public};
    ode(x, t) = root(x + 1 {dimensionless}, 3 {dimensionless});
  enddef;
enddef;
`)
  })
})

describe('brackets only where needed', () => {
  test.each([
    ['(plus a (times b c))', 'a + b * c'],
    ['(times (plus a b) c)', '(a + b) * c'],
    ['(minus (minus a b) c)', 'a - b - c'],
    ['(minus a (minus b c))', 'a - (b - c)'],
    ['(minus a (plus b c))', 'a - (b + c)'],
    ['(divide a (times b c))', 'a / (b * c)'],
    ['(divide (times a b) c)', 'a * b / c'],
    ['(times (divide a b) c)', 'a / b * c'],
    ['(plus (plus a b) c)', '(a + b) + c'],
    ['(plus a b c)', 'a + b + c'],
    ['(plus a (minus b c))', 'a + (b - c)'],
    ['(plus (minus a b) c)', 'a - b + c'],
    ['(minus x)', '-x'],
    ['(minus 5)', '-5'],
    ['(minus (times a b))', '-(a * b)'],
    ['(minus (minus a))', '-(-a)'],
    ['(minus (sin x))', '-sin(x)'],
    ['(times (minus a) b)', '-a * b'],
    ['(minus a (minus b))', 'a - -b'],
    ['(sin (plus a b))', 'sin(a + b)'],
    ['(power (plus a b) 2)', 'power(a + b, 2)'],
    ['(min (gt a b) c)', 'min((a > b), c)'],
    ['(plus (gt a b) 1)', '(a > b) + 1'],
    ['(not (or a b))', 'not(a or b)'],
    ['(plus (piecewise (piece 1 a)) 2)', 'sel\n  case a: 1;\nendsel + 2'],
  ])('%s', (tree, text) => {
    expect(print(tree)).toBe(text)
    expect(rhs(text)).toBe(tree)
  })

  test.each([
    ['(or (and a b) c)', '(a and b) or c'],
    ['(or a (and b c))', 'a or (b and c)'],
    ['(and (or a b) c)', '(a or b) and c'],
    ['(and a b c)', 'a and b and c'],
    ['(and (and a b) c)', '(a and b) and c'],
    ['(or (gt a b) (leq c d))', 'a > b or c <= d'],
    ['(eq (gt a b) #true)', '(a > b) == true'],
    ['(eq (plus a b) c)', 'a + b == c'],
  ])('condition %s', (condition, text) => {
    const tree = `(piecewise (piece 1 ${condition}))`
    const printed = print(tree)
    expect(printed).toBe(`sel\n  case ${text}: 1;\nendsel`)
    expect(rhs(printed)).toBe(tree)
  })
})

describe('generateResult reports what it cannot print', () => {
  test.each([
    ['<apply><eq/><ci>y</ci><apply><ceil/><ci>x</ci></apply></apply>', '<ceil> is not supported in CellML Text'],
    ['<apply><eq/><ci>y</ci><apply><factorial/><ci>x</ci></apply></apply>', '<factorial> is not supported in CellML Text'],
    ['<apply><eq/><ci>y</ci><ci>e</ci></apply>', "The variable 'e' can't be written in CellML Text, because 'e' is a reserved word"],
    ['<apply><eq/><ci>y</ci><ci>sel</ci></apply>', "The variable 'sel' can't be written in CellML Text, because 'sel' is a reserved word"],
    ['<ci>x</ci>', 'The top level of <math> can only hold equations (<apply><eq/>…</apply>)'],
    ['<apply><gt/><ci>x</ci><ci>y</ci></apply>', 'The top level of <math> can only hold equations (<apply><eq/>…</apply>)'],
    // The broken output of 0.3.1: the degree and base were written as operands.
    ['<apply><eq/><ci>y</ci><apply><root/><ci>x</ci><cn cellml:units="dimensionless">3</cn></apply></apply>', '<root> needs 1 operand, but has 2'],
    ['<apply><eq/><ci>y</ci><apply><log/><ci>x</ci><cn cellml:units="dimensionless">2</cn></apply></apply>', '<log> needs 1 operand, but has 2'],
    ['<apply><eq/><ci>y</ci><apply><diff/><ci>x</ci></apply></apply>', 'A derivative needs a <bvar> holding one <ci>, and optionally a <degree>'],
    ['<apply><eq/><ci>y</ci><apply><plus/><degree><ci>n</ci></degree><ci>a</ci><ci>b</ci></apply></apply>', '<degree> is not supported here in <apply><plus/>…</apply>'],
    ['<apply><eq/><ci>y</ci><apply><divide/><ci>a</ci><ci>b</ci><ci>c</ci></apply></apply>', '<divide> needs 2 operands, but has 3'],
    ['<apply><eq/><ci>y</ci><apply><power/><ci>a</ci></apply></apply>', '<power> needs 2 operands, but has 1'],
    ['<apply id="eq1"><eq/><ci>y</ci><ci>x</ci></apply>', "The attribute 'id' on <apply> can't be written in CellML Text"],
    ['<apply><eq/><ci>y</ci><cn cellml:units="dimensionless" type="integer">3</cn></apply>', "Numbers of type 'integer' are not supported in CellML Text"],
    ['<apply><eq/><ci>y</ci><cn cellml:units="dimensionless">abc</cn></apply>', "The number 'abc' is not valid"],
    ['<apply><eq/><ci>y</ci><apply><ci>f</ci><ci>x</ci></apply></apply>', "<ci> can't be used as an operator in CellML Text"],
    ['<apply><eq/><ci>y</ci><piecewise><piece><ci>a</ci></piece></piecewise></apply>', '<piece> is not supported here in <piecewise>'],
    ['<apply><eq/><ci>y</ci><apply><not/><ci>a</ci><ci>b</ci></apply></apply>', '<not> needs 1 operand, but has 2'],
  ])('%s', (math, message) => {
    const result = report(math)
    expect(result.errors.map((e) => e.message)).toEqual([message])
    expect(result.text).toMatch(/#unsupported:[^#\s]+#/)
    expect(result.text).not.toContain('/*')
    // The marker makes the text fail to parse, rather than silently parse to something else.
    expect(parseSimple.bind(null, result.text)).toThrow()
  })

  test('errors give the path to the node', () => {
    const result = report('<apply><eq/><ci>y</ci></apply><apply><eq/><ci>y</ci><apply><plus/><ci>a</ci><apply><ceil/><ci>x</ci></apply></apply></apply>')
    expect(result.errors).toEqual([
      { message: 'The top level of <math> can only hold equations (<apply><eq/>…</apply>)', path: "/model/component[@name='c']/math[1]/apply[1]" },
      { message: '<ceil> is not supported in CellML Text', path: "/model/component[@name='c']/math[1]/apply[2]/apply[1]/apply[1]/ceil[1]" },
    ])
  })

  test('generate() returns the same text', () => {
    const xml = modelWith('<apply><eq/><ci>y</ci><apply><ceil/><ci>x</ci></apply></apply>')
    expect(generator.generate(xml)).toBe(generator.generateResult(xml).text)
  })

  test('XML that does not parse', () => {
    expect(generator.generateResult('<model')).toEqual({
      text: '// Error generating text: XML Parsing Error',
      errors: [{ message: 'Error generating text: XML Parsing Error' }],
    })
  })

  test('supported math reports nothing', () => {
    const math = equationsOf(new DOMParser().parseFromString(modelWithRhs('(plus a 1)'), 'application/xml'))
    expect(math).toEqual(['(eq y (plus a 1))'])
    expect(report(`<apply><eq/><ci>y</ci>${fromSexpr('(plus a 1)')}</apply>`).errors).toEqual([])
  })
})
