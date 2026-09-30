import { describe, expect, test } from 'vitest'

import { CellMLModelSession } from '../CellMLModelSession'
import { parseLayout, serializeLayout } from '../CellMLTextLayout'
import { CellMLTextParser } from '../CellMLTextParser'

const TEXT = `// A small model
def model m as
  def comp c as
    // Parameters
    var t: second {interface: public};
    var a: mV {init: 1, interface: public};  // membrane
    var b: mV {interface: public};
    var y: mV {interface: public};

    // The sum
    y = (a + b);  // kept brackets
    b = 2 {mV} *
        a;
    ode(a, t) = 1 {mV_per_s};
  enddef;
enddef;
`

/** A session that has loaded TEXT's model and layout, as a host would after reading both files. */
function loaded(): CellMLModelSession {
  const parsed = new CellMLTextParser().parse(TEXT)
  const session = new CellMLModelSession()
  session.setXml(parsed.xml!, parseLayout(serializeLayout(parsed.layout!)))
  return session
}

describe('CellMLModelSession keeps the layout', () => {
  test('loading the XML with its layout gives the text back', () => {
    expect(loaded().text).toBe(TEXT)
  })

  test('without the layout, the text is the canonical one', () => {
    const session = new CellMLModelSession()
    session.setXml(new CellMLTextParser().parse(TEXT).xml!)
    expect(session.text).not.toContain('//')
  })

  test('Simple Mode shows the equations with their comments, and switching back restores the rest', () => {
    const session = loaded()
    session.setMode({ simple: true })
    expect(session.text).toBe(`// The sum
y = (a + b);  // kept brackets
b = 2 {mV} *
    a;
ode(a, t) = 1 {mV_per_s};
`)
    session.setMode({ simple: false })
    expect(session.text).toBe(TEXT)
  })

  test('an equation edited in Simple Mode keeps its comments, and the var lines keep theirs', () => {
    const session = loaded()
    session.setMode({ simple: true })
    session.setText(session.text.replace('b = 2 {mV} *\n    a;', 'b = 3 {mV} * a;  // changed'))
    session.setMode({ simple: false })
    expect(session.text).toBe(TEXT.replace('b = 2 {mV} *\n        a;', 'b = 3 {mV} * a;  // changed'))
  })

  test('renaming the component in Simple Mode keeps the layout', () => {
    const session = loaded()
    session.setMode({ simple: true })
    session.setComponentName('d')
    session.setMode({ simple: false })
    expect(session.text).toBe(TEXT.replace('def comp c as', 'def comp d as'))
  })

  test('text that does not parse keeps the last layout', () => {
    const session = loaded()
    const layout = session.layout
    session.setText('def model m as nonsense')
    expect(session.errors).not.toEqual([])
    expect(session.layout).toBe(layout)
  })

  test('a model changed elsewhere keeps the comments of what is still there', () => {
    const parsed = new CellMLTextParser().parse(TEXT)
    const session = new CellMLModelSession()
    session.setXml(parsed.xml!.replace('<cn cellml:units="mV">2</cn>', '<cn cellml:units="mV">5</cn>'), parsed.layout)
    expect(session.text).toBe(TEXT.replace('b = 2 {mV} *\n        a;', 'b = 5 {mV} * a;'))
  })
})
