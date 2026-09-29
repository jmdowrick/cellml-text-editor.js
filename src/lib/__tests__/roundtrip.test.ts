// @vitest-environment jsdom
// jsdom, because happy-dom 20 never frees a document once it has been queried, and this test parses thousands.

import { describe, expect, test } from 'vitest'

import { CellMLTextGenerator } from '../CellMLTextGenerator'
import { CellMLTextParser } from '../CellMLTextParser'
import { CORPUS_FILES, corpusComponents } from './helpers/corpus'
import { equationsOf } from './helpers/mathml'

/** The declared variables, with the defaults the text fills in. */
function variablesOf(doc: Document): string[] {
  return Array.from(doc.getElementsByTagName('variable')).map((v) =>
    [v.getAttribute('name'), v.getAttribute('units'), v.getAttribute('interface') || 'public', v.getAttribute('initial_value') ?? ''].join(' '),
  )
}

/** The first place two lists differ, so a failure shows one line rather than a whole library. */
function firstDifference(actual: string[], expected: string[]): { index: number; actual?: string; expected?: string } | null {
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
    if (actual[i] !== expected[i]) return { index: i, actual: actual[i], expected: expected[i] }
  }
  return null
}

const MODES = [
  { mode: 'Advanced', simplified: false },
  { mode: 'Simple', simplified: true },
]

/**
 * The bundled module libraries: generate -> parse -> generate must give the same
 * text, and the parsed math must be the source math.
 */
describe.each(MODES)('$mode Mode round trip', ({ simplified }) => {
  const generator = new CellMLTextGenerator({ simplified })
  const parser = new CellMLTextParser({ simplified, sourceLineAttribute: null })

  test.each(CORPUS_FILES)('%s', async (file) => {
    for (const { name, xml } of await corpusComponents(file)) {
      const where = `${file}, component ${name}`
      const source = new DOMParser().parseFromString(xml, 'application/xml')
      const first = generator.generateResult(xml)
      expect(first.errors, where).toEqual([])

      const parsed = parser.parse(first.text, { componentName: name })
      expect(parsed.errors, where).toEqual([])

      const second = generator.generateResult(parsed.xml!)
      expect(second.errors, where).toEqual([])
      expect(firstDifference(second.text.split('\n'), first.text.split('\n')), where).toBeNull()

      expect(firstDifference(equationsOf(parsed.doc!), equationsOf(source)), where).toBeNull()
      if (!simplified) expect(firstDifference(variablesOf(parsed.doc!), variablesOf(source)), where).toBeNull()
    }
  })
})
