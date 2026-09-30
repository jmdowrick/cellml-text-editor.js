// @vitest-environment jsdom
// jsdom, because happy-dom 20 never frees a document once it has been queried, and this test parses thousands.

/**
 * A layout never changes meaning: whatever layout is passed, the text parses to
 * the same CellML as the text written without one.
 */
import { describe, expect, test } from 'vitest'

import { mathFingerprint, MATHML_NS, variableFingerprint } from '../CellMLMathML'
import { CellMLTextGenerator } from '../CellMLTextGenerator'
import { commentsIn, LAYOUT_FORMAT, LAYOUT_VERSION, parseLayout, type TextLayout } from '../CellMLTextLayout'
import { CellMLTextParser } from '../CellMLTextParser'
import { CORPUS_FILES, corpusComponents } from './helpers/corpus'
import { decorate } from './helpers/decorate'
import { modelWith, modelWithRhs } from './helpers/mathml'
import { random, randomTrees } from './helpers/random'

const MODES = [
  { mode: 'Advanced', simplified: false },
  { mode: 'Simple', simplified: true },
]

/** Each component's equations in order, and its variables as a set. */
function signature(text: string, simplified: boolean): string | null {
  const doc = new CellMLTextParser({ simplified, sourceLineAttribute: null, recordLayout: false }).parse(text).doc
  if (!doc) return null
  return Array.from(doc.getElementsByTagName('component'))
    .map((c) =>
      JSON.stringify([
        c.getAttribute('name'),
        Array.from(c.getElementsByTagNameNS(MATHML_NS, 'math')).flatMap((m) => Array.from(m.children).map(mathFingerprint)),
        Array.from(c.getElementsByTagName('variable')).map(variableFingerprint).sort(),
      ]),
    )
    .join('\n')
}

/** Generates `xml` with and without `layout`, and checks the layout changed nothing but the look. */
function expectSameMeaning(generator: CellMLTextGenerator, xml: string, layout: TextLayout | null, where: string) {
  const plain = generator.generateResult(xml)
  const laidOut = generator.generateResult(xml, { layout })
  expect(laidOut.layoutRejected, where).toBeUndefined()
  expect(laidOut.errors, where).toEqual(plain.errors)
  if (plain.errors.length === 0) {
    const expected = signature(plain.text, generator.simplified)
    expect(expected, where).not.toBeNull()
    expect(signature(laidOut.text, generator.simplified), `${where}\n${laidOut.text}`).toBe(expected)
  }
  return laidOut.text
}

/** Changes the XML the way another tool might: drops, swaps or edits an equation, or renames a variable. */
function mutate(xml: string, seed: number): string {
  const next = random(seed)
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const math = doc.getElementsByTagNameNS(MATHML_NS, 'math')[0]
  const equations = math ? Array.from(math.children) : []
  const pick = <T,>(items: T[]) => items[Math.floor(next() * items.length)]

  switch (Math.floor(next() * 4)) {
    case 0:
      pick(equations)?.remove()
      break
    case 1: {
      const [a, b] = [pick(equations), pick(equations)]
      if (a && b && a !== b) math!.insertBefore(b, a)
      break
    }
    case 2: {
      const cn = pick(Array.from(doc.getElementsByTagNameNS(MATHML_NS, 'cn')).filter((c) => c.children.length === 0))
      if (cn) cn.textContent = '42'
      break
    }
    default: {
      const variable = pick(Array.from(doc.getElementsByTagName('variable')))
      const name = variable?.getAttribute('name')
      if (name) {
        variable!.setAttribute('name', `${name}_renamed`)
        for (const ci of Array.from(doc.getElementsByTagNameNS(MATHML_NS, 'ci'))) {
          if (ci.textContent?.trim() === name) ci.textContent = `${name}_renamed`
        }
      }
    }
  }
  return new XMLSerializer().serializeToString(doc)
}

describe.each(MODES)('$mode Mode: a layout never changes meaning', ({ simplified }) => {
  const generator = new CellMLTextGenerator({ simplified })
  const parser = new CellMLTextParser({ simplified })

  test.each(CORPUS_FILES)('%s: edited elsewhere, or another component', async (file) => {
    const components = await corpusComponents(file)
    const parsed = components.map(({ name, xml }, i) => {
      const result = parser.parse(decorate(generator.generate(xml), 3000 + i), { componentName: name })
      return { name, xml: result.xml!, layout: result.layout! }
    })

    parsed.forEach(({ name, xml, layout }, i) => {
      const where = `${file}, component ${name}`
      for (let seed = 0; seed < 4; seed++) {
        const text = expectSameMeaning(generator, mutate(xml, seed * 100 + i), layout, `${where}, mutation ${seed}`)
        // Advanced Mode shows every comment, even those whose statement went.
        if (!simplified) expect(commentsIn(text).sort(), `${where}, mutation ${seed}`).toEqual(commentsIn(decorate(generator.generate(components[i]!.xml), 3000 + i)).sort())
      }
      const other = parsed[(i + 1) % parsed.length]!
      expectSameMeaning(generator, xml, other.layout, `${where}, with the layout of ${other.name}`)
    })
  }, 60_000)
})

describe('layouts made by hand', () => {
  const generator = new CellMLTextGenerator({ simplified: false })
  const xml = modelWith('<apply><eq/><ci>y</ci><apply><plus/><ci>a</ci><ci>b</ci></apply></apply>')

  /** A layout as a file edited by hand might hold it: not necessarily valid. */
  const layoutWith = (statement: object): TextLayout => ({
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    components: [{ name: 'c', leading: [], statements: [{ kind: 'eq', leading: [], text: '', ...statement }], footer: [] }],
  })

  test.each([
    ['two statements', { text: 'y = a + b; z = 1;' }],
    ['a statement and more', { text: 'y = a + b; enddef; def unit u as' }],
    ['text that does not parse', { text: 'y = a + ;' }],
    ['a different equation', { text: 'y = a - b;' }],
    ['a variable', { kind: 'var', text: 'var y: mV;' }],
    ['code as a comment', { text: 'y = (a + b);', leading: ['z = 1;'] }],
    ['a trailing comment that is not one', { text: 'y = (a + b);', trailing: ' z = 1;' }],
    ['a trailing comment over two lines', { text: 'y = (a + b);', trailing: ' // x\nz = 1;' }],
  ])('%s', (_, statement) => {
    const text = expectSameMeaning(generator, xml, layoutWith(statement), JSON.stringify(statement))
    expect(text).not.toContain('z = 1')
  })

  test('the matching text is used, brackets and all', () => {
    expect(expectSameMeaning(generator, xml, layoutWith({ text: 'y = (a +\n  b);' }), 'brackets')).toContain('    y = (a +\n      b);\n')
  })

  test('a units block the XML does not have leaves only its comments', () => {
    const layout: TextLayout = {
      format: LAYOUT_FORMAT,
      version: LAYOUT_VERSION,
      model: {
        leading: [],
        blocks: [{ kind: 'units', name: 'u', leading: ['// u'], trailing: '  // end of u' }, { kind: 'comp', name: 'c' }],
        footer: [],
        after: [],
      },
      components: [],
    }
    const text = expectSameMeaning(generator, xml, layout, 'units')
    expect(text).not.toContain('def unit')
    expect(text).toContain('  // u\n  // end of u\n')
  })

  test('parseLayout drops lines that are not comments', () => {
    const layout = parseLayout(JSON.stringify(layoutWith({ text: 'y = a + b;', leading: ['// ok', 'z = 1;', ''], trailing: 'z = 1;' })))
    expect(layout?.components[0]?.statements[0]).toEqual({ kind: 'eq', leading: ['// ok', ''], text: 'y = a + b;' })
  })

  test.each(['', '{}', '[]', 'null', '{"format":"cellml-text-layout","version":2,"components":[]}', '{"format":"other","version":1,"components":[]}'])(
    'parseLayout rejects %s',
    (json) => expect(parseLayout(json)).toBeNull(),
  )

  test('what the text cannot hold stays marked, even when the layout has the equation', () => {
    const withId = modelWith('<apply id="e1"><eq/><ci>y</ci><apply><plus/><ci>a</ci><ci>b</ci></apply></apply>')
    const result = generator.generateResult(withId, { layout: layoutWith({ text: 'y = (a + b);', leading: ['// sum'] }) })
    expect(result.text).toContain('    // sum\n    #unsupported:@id# y = a + b;\n')
    expect(result.errors).toEqual(generator.generateResult(withId).errors)
  })
})

describe('random trees', () => {
  const generator = new CellMLTextGenerator({ simplified: true })
  const parser = new CellMLTextParser({ simplified: true })

  test('extra brackets survive, and never change the tree', () => {
    for (const [i, tree] of randomTrees(20260930, 300).entries()) {
      const xml = modelWithRhs(tree)
      const text = decorate(generator.generate(xml), i)
      const parsed = parser.parse(text)
      expect(parsed.errors, text).toEqual([])
      expect(generator.generate(parsed.xml!, { layout: parsed.layout }), tree).toBe(text)
      expectSameMeaning(generator, xml, parsed.layout, tree)
    }
  }, 60_000)
})
