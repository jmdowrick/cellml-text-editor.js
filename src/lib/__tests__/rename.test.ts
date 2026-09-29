import { describe, expect, test } from 'vitest'

import { CellMLModelSession } from '../CellMLModelSession'
import { detectRenames, renameIdentifier } from '../CellMLRename'

describe('detectRenames', () => {
  test('one use renamed', () => {
    expect(detectRenames(['t', 'V', 'V', 'i'], ['t', 'Vm', 'V', 'i'])).toEqual([{ from: 'V', to: 'Vm' }])
  })

  test('every use renamed', () => {
    expect(detectRenames(['t', 'V', 'V', 'i'], ['t', 'Vm', 'Vm', 'i'])).toEqual([{ from: 'V', to: 'Vm' }])
  })

  test('a rename alongside a term added elsewhere', () => {
    expect(detectRenames(['y', 'a', 'b'], ['y', 'x', 'a', 'c'])).toEqual([{ from: 'b', to: 'c' }])
  })

  test('one name renamed two ways is ambiguous', () => {
    expect(detectRenames(['x', 'a', 'x'], ['y', 'a', 'z'])).toEqual([])
  })

  test('two names renamed to one is ambiguous', () => {
    expect(detectRenames(['x', 'a', 'w'], ['y', 'a', 'y'])).toEqual([])
  })

  test('an added or removed term is not a rename', () => {
    expect(detectRenames(['y', 'a'], ['y', 'a', 'b'])).toEqual([])
    expect(detectRenames(['y', 'a', 'b'], ['y', 'b'])).toEqual([])
  })
})

describe('renameIdentifier', () => {
  test('renames every use', () => {
    expect(renameIdentifier('ode(V, t) = V + i;\n', 'V', 'Vm')).toBe('ode(Vm, t) = Vm + i;\n')
  })

  test('leaves units annotations, function names and longer names alone', () => {
    expect(renameIdentifier('y = x*1 {x} + x2 + sin(x);', 'x', 'z')).toBe('y = z*1 {x} + x2 + sin(z);')
    expect(renameIdentifier('y = exp(1);', 'exp', 'z')).toBe('y = exp(1);')
  })

  test('keeps comments and whitespace', () => {
    const text = '// x is the input\ny   =  x ;  // x again\n'
    expect(renameIdentifier(text, 'x', 'z')).toBe('// x is the input\ny   =  z ;  // x again\n')
  })
})

const HH = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="hh">
  <component name="membrane">
    <variable name="V" units="millivolt" initial_value="-65" interface="public"/>
    <variable name="t" units="millisecond" interface="public"/>
    <variable name="g" units="siemens" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply>
        <apply><plus/><ci>V</ci><ci>i_Ion</ci></apply>
      </apply>
    </math>
  </component>
</model>`

function simpleSession(text = 'ode(V, t) = V + i_Ion;\n') {
  const session = new CellMLModelSession()
  session.setXml(HH)
  session.setMode({ simple: true })
  session.setText(text)
  return session
}

function variable(session: CellMLModelSession, name: string) {
  return session.components[0]?.variables.find((v) => v.name === name)
}

describe('CellMLModelSession renames (Simple Mode)', () => {
  test('a variable renamed everywhere keeps its units and initial value', () => {
    const session = simpleSession()
    session.setText('ode(Vm, t) = Vm + i_Ion;\n')

    expect(variable(session, 'Vm')).toMatchObject({ units: 'millivolt', initialValue: '-65', role: 'state' })
    expect(variable(session, 'V')).toBeUndefined()
    expect(session.missing).toEqual(['i_Ion'])
    expect(session.pendingRename).toBeNull()
    expect(session.xml).toContain('<variable name="Vm" units="millivolt" initial_value="-65" interface="public"/>')
  })

  test('the values follow a name while it is typed', () => {
    const session = simpleSession()
    session.setText('ode(Vm, t) = Vm + i_Ion;\n')
    session.setText('ode(Vme, t) = Vme + i_Ion;\n')

    expect(variable(session, 'Vme')).toMatchObject({ units: 'millivolt', initialValue: '-65' })
  })

  test('a parse error in between does not lose the values', () => {
    const session = simpleSession()
    session.setText('ode(, t) = + i_Ion;\n')
    expect(session.errors).not.toEqual([])
    session.setText('ode(W, t) = W + i_Ion;\n')

    expect(variable(session, 'W')).toMatchObject({ units: 'millivolt', initialValue: '-65' })
  })

  test('a partial rename copies the values and offers to rename the rest', () => {
    const session = simpleSession()
    session.setText('ode(Vm, t) = V + i_Ion;\n')

    expect(variable(session, 'Vm')).toMatchObject({ units: 'millivolt', initialValue: '-65' })
    expect(variable(session, 'V')).toMatchObject({ units: 'millivolt' })
    expect(session.pendingRename).toEqual({ from: 'V', to: 'Vm', uses: 1 })

    const revision = session.textRevision
    session.renameEverywhere()

    expect(session.text).toBe('ode(Vm, t) = Vm + i_Ion;\n')
    expect(session.textRevision).toBe(revision + 1)
    expect(variable(session, 'V')).toBeUndefined()
    expect(variable(session, 'Vm')).toMatchObject({ units: 'millivolt', initialValue: '-65' })
    expect(session.pendingRename).toBeNull()
  })

  test('the offer follows the new name while it is typed', () => {
    const session = simpleSession()
    session.setText('ode(Vm, t) = V + i_Ion;\n')
    session.setText('ode(Vme, t) = V + i_Ion;\n')

    expect(session.pendingRename).toEqual({ from: 'V', to: 'Vme', uses: 1 })
  })

  test('dismissing a partial rename keeps both variables', () => {
    const session = simpleSession()
    session.setText('ode(Vm, t) = V + i_Ion;\n')
    session.dismissRename()

    expect(session.pendingRename).toBeNull()
    expect(session.text).toBe('ode(Vm, t) = V + i_Ion;\n')
    expect(variable(session, 'V')).toMatchObject({ units: 'millivolt' })
    expect(variable(session, 'Vm')).toMatchObject({ units: 'millivolt' })
  })

  test('renaming the rest by hand clears the offer', () => {
    const session = simpleSession()
    session.setText('ode(Vm, t) = V + i_Ion;\n')
    session.setText('ode(Vm, t) = Vm + i_Ion;\n')

    expect(session.pendingRename).toBeNull()
  })

  test('renaming to an existing variable keeps its own units', () => {
    const session = simpleSession()
    session.setText('ode(g, t) = g + i_Ion;\n')

    expect(variable(session, 'g')).toMatchObject({ units: 'siemens', initialValue: '' })
  })
})
