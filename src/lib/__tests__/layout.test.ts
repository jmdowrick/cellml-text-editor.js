import { describe, expect, test } from 'vitest'

import { CellMLTextGenerator } from '../CellMLTextGenerator'
import { mergeSimpleLayout, parseLayout, serializeLayout, type TextLayout } from '../CellMLTextLayout'
import { CellMLTextParser } from '../CellMLTextParser'

const advanced = new CellMLTextParser({ simplified: false })
const simple = new CellMLTextParser({ simplified: true })
const advancedText = new CellMLTextGenerator({ simplified: false })
const simpleText = new CellMLTextGenerator({ simplified: true })

function parse(text: string, parser = advanced) {
  const result = parser.parse(text, { componentName: 'c' })
  if (!result.xml || !result.layout) throw new Error(JSON.stringify(result.errors))
  return { xml: result.xml, layout: result.layout }
}

/** Text -> XML + layout -> text. */
function again(text: string, parser = advanced, generator = advancedText): string {
  const { xml, layout } = parse(text, parser)
  return generator.generate(xml, { layout })
}

describe('recording a layout', () => {
  test('everything around the model and its components', () => {
    const text = `// Model notes

def model m as  // after model
  // before units
  def unit mV as
    unit volt {prefix: milli};  // inside units
  enddef;  // after units

  // before c
  def comp c as  // after comp
    var x: mV {interface: public};
    x = 1 {mV};  // trailing
      // indented deeper
    // footer
  enddef;  // after enddef
  // model footer
enddef;  // the end
// after everything
`
    const { layout } = parse(text)
    expect(layout.model).toEqual({
      leading: ['// Model notes', ''],
      trailing: '  // after model',
      blocks: [
        { kind: 'units', name: 'mV', leading: ['// before units', '// inside units'], trailing: '  // after units' },
        { kind: 'comp', name: 'c' },
      ],
      footer: ['// model footer'],
      endTrailing: '  // the end',
      after: ['// after everything'],
    })
    expect(layout.components).toEqual([
      {
        name: 'c',
        leading: ['', '// before c'],
        trailing: '  // after comp',
        statements: [
          { kind: 'var', leading: [], text: 'var x: mV {interface: public};' },
          { kind: 'eq', leading: [], text: 'x = 1 {mV};', trailing: '  // trailing' },
        ],
        footer: ['  // indented deeper', '// footer'],
        endTrailing: '  // after enddef',
      },
    ])
    // Units come from the XML, which has none here: only their comments are left.
    expect(again(text)).toBe(
      text.replace('  def unit mV as\n    unit volt {prefix: milli};  // inside units\n  enddef;  // after units\n', '  // inside units\n  // after units\n'),
    )
  })

  test('units the XML has are written from the XML, with their comments', () => {
    const text = 'def model m as\n  // mV\n  def unit mV as\n    unit volt;\n  enddef;  // millivolt\n\n  def comp c as\n    y = a;\n  enddef;\nenddef;\n'
    const { xml, layout } = parse(text)
    const withUnits = xml.replace('<component', '<units name="mV"><unit prefix="milli" units="volt"/></units><component')
    expect(advancedText.generate(withUnits, { layout })).toBe(text.replace('unit volt;', 'unit volt {prefix: milli};'))
  })

  test('a statement over several lines is stored relative to its first line', () => {
    const { layout } = parse('y = a +\n      // why\n      b;\n', simple)
    expect(layout.components[0]!.statements[0]!.text).toBe('y = a +\n      // why\n      b;')
    const indented = parse('def model m as\n  def comp c as\n    y = a +\n        b;\n  enddef;\nenddef;\n')
    expect(indented.layout.components[0]!.statements[0]!.text).toBe('y = a +\n    b;')
  })

  test('Simple Mode text that is only comments', () => {
    const { layout } = parse('// nothing yet\n\n// still nothing\n\n', simple)
    expect(layout.components[0]).toEqual({ name: 'c', leading: [], statements: [], footer: ['// nothing yet', '', '// still nothing'] })
    expect(again('// nothing yet\n\n// still nothing\n', simple, simpleText)).toBe('// nothing yet\n\n// still nothing\n')
  })

  test.each([
    ['CRLF line endings', 'y = a;\r\n// c\r\nz = b;\r\n', 'y = a;\n// c\nz = b;\n'],
    ['trailing spaces', 'y = a;   \n// c   \nz = b;\n', 'y = a;\n// c\nz = b;\n'],
    ['tabs in the indent', 'y = a +\n\tb;\n', 'y = a +\n  b;\n'],
    ['stray semicolons', 'y = a;;\n;\nz = b; ; // c\n', 'y = a;\n\nz = b;   // c\n'],
    ['two statements on a line', 'y = a; z = b;\n', 'y = a;\nz = b;\n'],
    ['a comment less indented than its statement', '  // c\n    y = a;\n', '// c\ny = a;\n'],
  ])('normal form: %s', (_, text, normal) => {
    expect(again(text, simple, simpleText)).toBe(normal)
    expect(again(normal, simple, simpleText)).toBe(normal)
  })

  test('comments inside the def lines move above them', () => {
    expect(again('def // one\nmodel m as\n  def comp // two\n c as\n    y = a;\n  enddef;\nenddef;\n')).toBe(
      '// one\ndef model m as\n  // two\n  def comp c as\n    y = a;\n  enddef;\nenddef;\n',
    )
  })

  test('the layout is saved and read back unchanged', () => {
    const { layout } = parse('// a\ny = (a);  // b\n\nz = b;\n// c\n', simple)
    expect(parseLayout(serializeLayout(layout))).toEqual(layout)
  })
})

describe('writing with a layout', () => {
  const model = (body: string) => `def model m as\n  def comp c as\n${body}  enddef;\nenddef;\n`

  test('a new equation goes where the XML has it, without comments', () => {
    const { layout } = parse(model('    // y\n    y = (a);\n    // z\n    z = (b);\n'))
    const { xml } = parse(model('    y = a;\n    w = c;\n    z = b;\n'))
    expect(advancedText.generate(xml, { layout })).toBe(model('    // y\n    y = (a);\n    w = c;\n    // z\n    z = (b);\n'))
  })

  test('an equation that has gone leaves its comments', () => {
    const { layout } = parse(model('    // y\n    y = a;  // why\n    z = b;\n'))
    const { xml } = parse(model('    z = b;\n'))
    expect(advancedText.generate(xml, { layout })).toBe(model('    // y\n    // why\n    z = b;\n'))
  })

  test('an equation changed elsewhere keeps its comments, with the comments inside it moved above', () => {
    const { layout } = parse(model('    // y\n    y = a +  // first\n        b;  // why\n'))
    const { xml } = parse(model('    y = a - b;\n'))
    expect(advancedText.generate(xml, { layout })).toBe(model('    // y\n    // first\n    y = a - b;  // why\n'))
  })

  test('the same equation twice', () => {
    const { layout } = parse(model('    // one\n    y = (a);\n    // two\n    y = (a);\n'))
    const { xml } = parse(model('    y = a;\n    y = a;\n'))
    expect(advancedText.generate(xml, { layout })).toBe(model('    // one\n    y = (a);\n    // two\n    y = (a);\n'))
  })

  test('var lines keep their place and spelling; a new one goes after the last', () => {
    const { layout } = parse(model('    var a: mV;\n    y = a;\n    // b\n    var b: mV;\n    z = b;\n'))
    const { xml } = parse(model('    var a: mV;\n    var b: mV {init: 2};\n    var c: mV;\n    y = a;\n    z = b;\n'))
    expect(advancedText.generate(xml, { layout })).toBe(
      model(
        '    var a: mV;\n    y = a;\n    // b\n    var b: mV {init: 2, interface: public};\n    var c: mV {interface: public};\n    z = b;\n',
      ),
    )
  })

  test('Simple Mode leaves out the var lines and their comments, and re-indents the equations', () => {
    const { xml, layout } = parse(model('    // vars\n    var a: mV;\n\n    // y\n    y = a +\n        b;\n'))
    expect(simpleText.generate(xml, { layout })).toBe('// y\ny = a +\n    b;\n')
  })

  test('a Simple Mode layout in Advanced Mode', () => {
    const { xml, layout } = parse('// y\ny = a +\n    b;\n\n// end\n', simple)
    expect(advancedText.generate(xml, { layout })).toBe(
      'def model unnamed_model as\n  def comp c as\n    // y\n    y = a +\n        b;\n\n    // end\n  enddef;\nenddef;\n',
    )
  })
})

describe('mergeSimpleLayout', () => {
  const advancedLayout = () =>
    parse('def model m as\n  def comp c as\n    var a: mV;\n    y = a;\n    // b\n    var b: mV;\n    z = b;\n    var w: mV;\n  enddef;\nenddef;\n').layout

  const names = (layout: TextLayout) => layout.components[0]!.statements.map((s) => s.text)

  test('var lines go back before the equation they were before', () => {
    const merged = mergeSimpleLayout(advancedLayout(), parse('x = 1;\nz = b;\ny = a;\n', simple).layout)
    expect(names(merged)).toEqual(['x = 1;', 'var b: mV;', 'z = b;', 'var a: mV;', 'y = a;', 'var w: mV;'])
    expect(merged.model).toEqual(advancedLayout().model)
  })

  test('var lines whose equation changed stay at the same position', () => {
    const merged = mergeSimpleLayout(advancedLayout(), parse('y = 2 * a;\nz = 2 * b;\n', simple).layout)
    expect(names(merged)).toEqual(['var a: mV;', 'y = 2 * a;', 'var b: mV;', 'z = 2 * b;', 'var w: mV;'])
  })

  test('with nothing to merge into, the Simple layout is the layout', () => {
    const layout = parse('y = a;\n', simple).layout
    expect(mergeSimpleLayout(null, layout)).toBe(layout)
  })
})
