import { describe, expect, test } from 'vitest'

import { CellMLTextParser } from '../CellMLTextParser'
import { ALL_CASES } from './helpers/fixtures'
import { parseError, parseSimple, rhs } from './helpers/mathml'

describe('text to MathML', () => {
  test.each(ALL_CASES)('$text', ({ text, tree }) => {
    expect(rhs(text)).toBe(tree)
  })

  test('sqrt writes <root/>, never <sqrt/>', () => {
    const { xml } = parseSimple('y = sqrt(x);')
    expect(xml).toContain('<root/>')
    expect(xml).not.toContain('sqrt')
  })

  test('e-notation keeps the <sep/> form', () => {
    expect(parseSimple('y = 1.5e-3;').xml).toContain('<cn cellml:units="dimensionless" type="e-notation">1.5<sep/>-3</cn>')
  })

  test('the document is XML under happy-dom', () => {
    const { xml, doc } = parseSimple('y = x;')
    expect(doc.documentElement.localName).toBe('model')
    expect(doc.documentElement.namespaceURI).toBe('http://www.cellml.org/cellml/2.0#')
    expect(xml).not.toMatch(/<(html|head|body)\b/i)
  })

  test('Advanced Mode', () => {
    const parser = new CellMLTextParser({ sourceLineAttribute: null })
    const result = parser.parse(`def model m as
  def comp c as
    var x: mV {init: -1.5e-3, interface: public_and_private};
    var t: ms {interface: none};
    ode(x, t) = -x;
  enddef;
enddef;`)
    expect(result.errors).toEqual([])
    expect(result.xml).toContain('<variable name="x" units="mV" initial_value="-1.5e-3" interface="public_and_private"/>')
    expect(result.xml).toContain('<variable name="t" units="ms" interface="none"/>')
  })
})

describe('parse errors', () => {
  test.each([
    ['y = ceil(x);', "Unknown function 'ceil'. Did you mean 'ceiling'?"],
    ['y = log10(x);', "Unknown function 'log10'. Did you mean 'log(x, 10)'?"],
    ['y = diff(x);', "Unknown function 'diff'. Did you mean 'ode'?"],
    ['y = Sin(x);', "Unknown function 'Sin'. Did you mean 'sin'?"],
    ['y = mode(x);', "Unknown function 'mode'."],
    ['y = foo(x);', "Unknown function 'foo'."],
    ['y = constructor(x);', "Unknown function 'constructor'."],
    ['y = e(x);', "Unknown function 'e'."],
  ])('unknown function: %s', (text, message) => {
    expect(parseError(text)).toBe(message)
  })

  test.each([
    ['y = root(x);', "'root' takes 2 arguments (the value and the degree), got 1"],
    ['y = sqrt(x, 2);', "'sqrt' takes 1 argument (the value), got 2"],
    ['y = sin();', "'sin' takes 1 argument, got 0"],
    ['y = log(x, 2, 3);', "'log' takes 1 or 2 arguments (the value, and optionally the base), got 3"],
    ['y = min(x);', "'min' takes 2 or more arguments, got 1"],
    ['y = power(x);', "'power' takes 2 arguments (the base and the exponent), got 1"],
    [
      'y = ode(x);',
      "'ode' takes 2 or 3 arguments (the variable, the variable it is differentiated with respect to, and optionally the order), got 1",
    ],
  ])('wrong argument count: %s', (text, message) => {
    expect(parseError(text)).toBe(message)
  })

  test.each([
    ['y = ode(x, 2);', "The second argument of 'ode' must be a variable name, e.g. ode(x, t)"],
    ['y = ode(x, (t));', "The second argument of 'ode' must be a variable name, e.g. ode(x, t)"],
    ['-x = y;', "Unexpected '-'. Expected an equation."],
    ['x;', "Syntax Error: Expected OpAss but found ';'"],
    ['(x) = y;', "Unexpected '('. Expected an equation."],
    ['y = 2e;', "Invalid number '2e'"],
    ['y = 2e-;', "Invalid number '2e-'"],
    ['y = 1 {2};', "Expected a units name but found '2'"],
    ['y = a < b < c;', "Syntax Error: Expected SemiColon but found '<'"],
    ['y = x # z;', "Syntax Error: Expected SemiColon but found '#'"],
  ])('%s', (text, message) => {
    expect(parseError(text)).toBe(message)
  })

  const advanced = (body: string) => {
    const parser = new CellMLTextParser()
    return parser.parse(`def model m as def comp c as ${body} enddef; enddef;`).errors[0]?.message
  }

  test.each([
    ['var x: mV {init: 1e};', "Invalid initial value '1e'. Use a number or a variable name."],
    ['var x: mV {interface: pub};', "Invalid interface 'pub'. Use one of: public, private, public_and_private, none."],
    ['var x: mV {foo: 1};', "Unknown variable property 'foo'. Use 'init' or 'interface'."],
    ['var e: mV;', "'e' is a constant, so it can't be used as a variable name"],
    ['var x: 2;', "Expected a units name but found '2'"],
    ['+ x = 1;', "Unexpected '+'. Expected 'var', an equation or 'enddef'."],
  ])('Advanced Mode: %s', (body, message) => {
    expect(advanced(body)).toBe(message)
  })

  test('errors give the line', () => {
    const parser = new CellMLTextParser({ simplified: true })
    expect(parser.parse('y = x;\n\nz = ceil(x);').errors[0]?.line).toBe(3)
  })
})
