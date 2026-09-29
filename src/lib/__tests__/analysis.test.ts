import { describe, expect, test } from 'vitest'

import { CellMLTextParser } from '../CellMLTextParser'
import { classifyVariables, isInitialisingKind, type VariableKind } from '../CellMLVariableClassification'
import { analyzeModel, analyzeModelXml, applyVariableDefinitions } from '../CellMLVariableResolution'
import { CORPUS_FILES, corpusComponents } from './helpers/corpus'
import { analyserKinds } from './helpers/libcellml'

const parser = new CellMLTextParser({ simplified: true, sourceLineAttribute: null })

/**
 * The model for Simple Mode `text`, with every variable it uses declared dimensionless.
 * `initialValues` gives some of them an initial value; `undeclared` are left without a declaration.
 */
function model(text: string, initialValues: Record<string, string> = {}, undeclared: string[] = []): XMLDocument {
  const result = parser.parse(text, { baseXml: '<model xmlns="http://www.cellml.org/cellml/2.0#" name="m"/>' })
  expect(result.errors, text).toEqual([])
  const doc = result.doc!
  const names = analyzeModel(doc).referenced.filter((name) => !undeclared.includes(name))
  applyVariableDefinitions(
    doc,
    names.map((name) => ({ name, units: 'dimensionless', initialValue: initialValues[name] })),
  )
  return doc
}

const analyse = (text: string, initialValues?: Record<string, string>) => analyzeModel(model(text, initialValues))

const classify = (text: string, initialValues?: Record<string, string>) =>
  Object.fromEntries(classifyVariables(analyse(text, initialValues)))

/** The parser's serializer declares the `cellml` prefix that `<cn>` units need; XMLSerializer under happy-dom doesn't. */
function xmlOf(doc: XMLDocument): string {
  return parser.serialize(doc.documentElement)
}

describe('analyzeModel: assigned, voi and dependencies', () => {
  test('an explicit equation', () => {
    const analysis = analyse('y = a*b + c;')
    expect(analysis.assigned).toEqual(['y'])
    expect(analysis.voi).toEqual([])
    expect(analysis.dependencies).toEqual([{ target: 'y', uses: ['a', 'b', 'c'] }])
  })

  test('a nested, piecewise right-hand side lists a piece value before its condition', () => {
    const analysis = analyse('y = sel case x > 0: a; otherwise: exp(b); endsel;')
    expect(analysis.assigned).toEqual(['y'])
    expect(analysis.dependencies).toEqual([{ target: 'y', uses: ['a', 'x', 'b'] }])
  })

  test('an ODE assigns its state, has no target, and uses its VOI', () => {
    const analysis = analyse('ode(V, t) = -V/tau;')
    expect(analysis.assigned).toEqual(['V'])
    expect(analysis.voi).toEqual(['t'])
    expect(analysis.dependencies).toEqual([{ target: null, uses: ['t', 'V', 'tau'] }])
  })

  test('an implicit equation assigns everything on its left and has no target', () => {
    const analysis = analyse('x + y = 0;')
    expect(analysis.assigned).toEqual(['x', 'y'])
    expect(analysis.dependencies).toEqual([{ target: null, uses: ['x', 'y'] }])
  })

  test('a self-reference keeps the name in uses', () => {
    expect(analyse('a = a + 1;').dependencies).toEqual([{ target: 'a', uses: ['a'] }])
  })

  // The same fixtures as phlynx's analyzeMathXml agreement test.
  test('an ODE alongside an explicit equation', () => {
    const analysis = analyse('ode(V, t) = k*I;\nI = -V;')
    expect(analysis.assigned).toEqual(['V', 'I'])
    expect(analysis.voi).toEqual(['t'])
    expect(analysis.dependencies).toEqual([
      { target: null, uses: ['t', 'V', 'k', 'I'] },
      { target: 'I', uses: ['V'] },
    ])
  })

  test('a piecewise self-reference', () => {
    expect(analyse('x = sel case b > 0: a; otherwise: x; endsel;').dependencies).toEqual([
      { target: 'x', uses: ['a', 'b', 'x'] },
    ])
  })

  test('an implicit equation with a variable on the right', () => {
    expect(analyse('y + z = a;').dependencies).toEqual([{ target: null, uses: ['y', 'z', 'a'] }])
  })

  test("only the first component's math is analysed", () => {
    const math = (lhs: string, rhs: string) =>
      `<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>${lhs}</ci><ci>${rhs}</ci></apply></math>`
    const analysis = analyzeModelXml(
      `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">` +
        `<component name="a">${math('y', 'x')}</component><component name="b">${math('q', 'p')}</component></model>`,
    )!
    expect(analysis.assigned).toEqual(['y'])
    expect(analysis.dependencies).toEqual([{ target: 'y', uses: ['x'] }])
  })

  test('the empty result has the new fields', () => {
    const analysis = analyzeModelXml('<model xmlns="http://www.cellml.org/cellml/2.0#" name="m"/>')!
    expect(analysis).toMatchObject({ assigned: [], voi: [], dependencies: [] })
  })
})

describe('classifyVariables', () => {
  test('a declared variable with an initial value is a constant', () => {
    expect(classify('y = k*t;', { k: '3' }).k).toBe('constant')
  })

  test('computed constants chain', () => {
    expect(classify('a = k*2;\nb = a + c;', { k: '3', c: '1' })).toMatchObject({
      a: 'computed_constant',
      b: 'computed_constant',
    })
  })

  test('a literal is a computed constant', () => {
    expect(classify('c = 1;').c).toBe('computed_constant')
  })

  test('a self-reference is still a computed constant', () => {
    expect(classify('x = x + k;', { k: '3' }).x).toBe('computed_constant')
  })

  test('anything that depends on the VOI, a state or an input is algebraic', () => {
    expect(classify('ode(V, t) = -V;\ny = t;', { V: '1' })).toMatchObject({ t: 'voi', V: 'state', y: 'algebraic' })
    expect(classify('ode(V, t) = -V;\ny = 2*V;', { V: '1' }).y).toBe('algebraic')
    expect(classify('y = i;')).toEqual({ y: 'algebraic', i: 'external' })
  })

  test('an implicit equation determines its unknowns; a constant in it stays a constant', () => {
    expect(classify('a + k = 5;', { k: '3' })).toEqual({ a: 'algebraic', k: 'constant' })
  })

  test('a cycle is algebraic', () => {
    expect(classify('a = b + k;\nb = 2*a;', { k: '3' })).toMatchObject({ a: 'algebraic', b: 'algebraic' })
  })

  test('a variable defined twice is algebraic', () => {
    expect(classify('a = k;\na = 2*k;', { k: '3' }).a).toBe('algebraic')
  })

  test('options.constants replaces the initial-value default', () => {
    const kinds = classifyVariables(analyse('y = k + c;', { k: '3' }), { constants: ['c'] })
    expect(Object.fromEntries(kinds)).toEqual({ y: 'algebraic', k: 'external', c: 'constant' })
  })

  test('declared variables come first, in document order', () => {
    const doc = model('y = a + b;')
    expect([...classifyVariables(analyzeModel(doc)).keys()]).toEqual(analyzeModel(doc).declared.map((d) => d.name))
  })

  test('isInitialisingKind', () => {
    const kinds: VariableKind[] = ['voi', 'state', 'constant', 'computed_constant', 'algebraic', 'external']
    expect(kinds.filter(isInitialisingKind)).toEqual(['constant', 'computed_constant'])
    expect(isInitialisingKind(undefined)).toBe(false)
  })
})

/** Our kinds and libcellml's for a model, telling libcellml that what we call external is external. */
async function kindsBothWays(xml: string) {
  const ours = classifyVariables(analyzeModelXml(xml)!)
  const externals = [...ours].filter(([, kind]) => kind === 'external').map(([name]) => name)
  return { ours, theirs: await analyserKinds(xml, externals) }
}

/** Expects libcellml to accept the model and classify every referenced variable as we do. */
async function expectAgreement(xml: string, label?: string) {
  const { ours, theirs } = await kindsBothWays(xml)
  expect(theirs, label).not.toBeNull()
  const referenced = analyzeModelXml(xml)!.referenced
  const sorted = (kinds: Map<string, VariableKind>, names: Iterable<string>) =>
    [...names].sort().map((name) => [name, kinds.get(name)])
  expect(sorted(ours, referenced), label).toEqual(sorted(theirs!, referenced))
}

describe('agrees with libcellml', () => {
  test.each([
    ['a constant', 'y = k*2;', { k: '3' }],
    ['chained computed constants', 'a = k*2;\nb = a + c;', { k: '3', c: '1' }],
    ['a literal', 'c = 1;', {}],
    ['a self-reference', 'x = x + 1;', {}],
    ['algebraic via the VOI', 'ode(V, t) = -V;\ny = t;', { V: '1' }],
    ['algebraic via a state', 'ode(V, t) = -V;\ny = 2*V;', { V: '1' }],
    ['algebraic via an input', 'y = i;', {}],
    ['an implicit equation', 'a + k = 5;', { k: '3' }],
  ])('%s', async (_, text, initialValues) => {
    await expectAgreement(xmlOf(model(text, initialValues)))
  })

  // libcellml rejects these outright, so it gives no kinds at all. We still classify them.
  describe('deliberate differences', () => {
    test('a cycle: libcellml finds it underconstrained', async () => {
      const { ours, theirs } = await kindsBothWays(xmlOf(model('a = b + k;\nb = 2*a;', { k: '3' })))
      expect(theirs).toBeNull()
      expect(ours.get('a')).toBe('algebraic')
    })

    test('a variable defined twice: libcellml finds it overconstrained', async () => {
      const { ours, theirs } = await kindsBothWays(xmlOf(model('a = 1;\na = 2;')))
      expect(theirs).toBeNull()
      expect(ours.get('a')).toBe('algebraic')
    })

    test('libcellml solves a system for an initialised variable, taking its initial value as a guess', async () => {
      const { ours, theirs } = await kindsBothWays(xmlOf(model('a = k;\na = 2*k;', { k: '3' })))
      expect(Object.fromEntries(theirs!)).toEqual({ a: 'algebraic', k: 'algebraic' })
      expect(Object.fromEntries(ours)).toEqual({ a: 'algebraic', k: 'constant' })
    })

    test('a variable with an initial value, computed from an input: libcellml ignores the equation', async () => {
      const { ours, theirs } = await kindsBothWays(xmlOf(model('a = 2*v;', { a: '1' })))
      expect(theirs?.get('a')).toBe('constant')
      expect(ours.get('a')).toBe('algebraic')
    })

    test('a variable used but not declared: libcellml finds the model invalid', async () => {
      const { ours, theirs } = await kindsBothWays(xmlOf(model('y = i;', {}, ['i'])))
      expect(theirs).toBeNull()
      expect(ours.get('i')).toBe('external')
    })
  })

  describe('on the corpus', () => {
    // Components that hit one of the deliberate differences above.
    const KNOWN_DIFFERENCES = new Set([
      'gas_exchange_modules.cellml/temp', // C_O2_out has an initial value and is computed from the input v
    ])
    let compared = 0

    test.each(CORPUS_FILES)('%s', async (file) => {
      for (const { name, xml } of await corpusComponents(file)) {
        if (KNOWN_DIFFERENCES.has(`${file}/${name}`)) continue
        const label = `${file}, component ${name}`
        if ((await kindsBothWays(xml)).theirs === null) {
          // The only reason libcellml may reject a corpus component: it uses a variable it doesn't declare.
          expect(analyzeModelXml(xml)!.unresolved, label).not.toEqual([])
          continue
        }
        await expectAgreement(xml, label)
        compared++
      }
    })

    // Runs after the files above, so the corpus can't pass by comparing nothing. 251 of 260 on libcellml 0.7.1.
    test('compares most components', () => {
      expect(compared).toBeGreaterThanOrEqual(251)
    })
  })
})
