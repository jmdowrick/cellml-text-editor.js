// @vitest-environment jsdom
// jsdom, because happy-dom 20 never frees a document once it has been queried, and this test parses thousands.

import { createHash } from 'node:crypto'

import { describe, expect, test } from 'vitest'

import { CellMLTextGenerator } from '../CellMLTextGenerator'
import { CellMLTextParser } from '../CellMLTextParser'
import { CORPUS_FILES, corpusComponents } from './helpers/corpus'
import { decorate } from './helpers/decorate'

const MODES = [
  { mode: 'Advanced', simplified: false },
  { mode: 'Simple', simplified: true },
]

/**
 * The XML a parse produces, pinned. Comments, blank lines, wrapping and extra
 * brackets never reach the XML, and the snapshots were taken before the layout
 * sidecar existed, so recording a layout can't have changed what is saved.
 */
describe.each(MODES)('$mode Mode parse output', ({ simplified }) => {
  const generator = new CellMLTextGenerator({ simplified })
  const parser = new CellMLTextParser({ simplified })

  test.each(CORPUS_FILES)('%s', async (file) => {
    const xmls: string[] = []
    for (const [index, { name, xml }] of (await corpusComponents(file)).entries()) {
      const where = `${file}, component ${name}`
      const plain = generator.generate(xml)
      const decorated = decorate(plain, index + 1)

      const fromPlain = parser.parse(plain, { componentName: name })
      const fromDecorated = parser.parse(decorated, { componentName: name })
      expect(fromDecorated.errors, `${where}\n${decorated}`).toEqual([])
      expect(fromDecorated.xml, where).toBe(fromPlain.xml)
      xmls.push(fromDecorated.xml!)
    }
    expect(createHash('sha1').update(xmls.join('\n')).digest('hex')).toMatchSnapshot()
  })
})
