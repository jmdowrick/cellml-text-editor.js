// @vitest-environment jsdom
// jsdom, because happy-dom 20 never frees a document once it has been queried, and this test parses thousands.

import { describe, expect, test } from 'vitest'

import { CellMLTextGenerator } from '../CellMLTextGenerator'
import { commentsIn, parseLayout, serializeLayout } from '../CellMLTextLayout'
import { CellMLTextParser } from '../CellMLTextParser'
import { CORPUS_FILES, corpusComponents } from './helpers/corpus'
import { decorate } from './helpers/decorate'

const MODES = [
  { mode: 'Advanced', simplified: false },
  { mode: 'Simple', simplified: true },
]

/** Text that isn't in normal form: CRLF, tabs, trailing spaces, stray `;` and two statements on a line. */
function roughen(text: string): string {
  const lines = text.split('\n')
  let joined = false
  return lines
    .map((line, i) => {
      if (i % 7 === 3) line = line.replace(/^( +)/, (ws) => '\t'.repeat(Math.ceil(ws.length / 2)))
      if (i % 5 === 1 && line.trim()) line += '   '
      if (i % 11 === 2 && /;$/.test(line) && !line.includes('//') && !/^\s*(case|otherwise)/.test(line)) line += ';'
      if (!joined && i > 0 && /= [^;]*;$/.test(lines[i - 1]!) && /^\s*\w+ = [^;]*;$/.test(line) && !lines[i - 1]!.includes('//')) {
        joined = true
        return '\u0000' + line.trim()
      }
      return line
    })
    .join('\r\n')
    .replace(/\r\n\u0000/g, ' ')
}

describe.each(MODES)('$mode Mode: text -> CellML + layout -> the same text', ({ simplified }) => {
  const generator = new CellMLTextGenerator({ simplified })
  const parser = new CellMLTextParser({ simplified })

  test.each(CORPUS_FILES)('%s', async (file) => {
    for (const [index, { name, xml }] of (await corpusComponents(file)).entries()) {
      const where = `${file}, component ${name}`
      const text = decorate(generator.generate(xml), 1000 + index)
      const parsed = parser.parse(text, { componentName: name })
      expect(parsed.errors, where).toEqual([])

      // The layout survives being saved.
      const layout = parseLayout(serializeLayout(parsed.layout!))
      expect(layout, where).toEqual(parsed.layout)

      const result = generator.generateResult(parsed.xml!, { layout })
      expect(result.layoutRejected, where).toBeUndefined()
      expect(result.text, where).toBe(text)

      // Recording a layout doesn't change the XML.
      expect(new CellMLTextParser({ simplified, recordLayout: false }).parse(text, { componentName: name }).xml, where).toBe(parsed.xml)
    }
  }, 60_000)

  test.each(CORPUS_FILES)('%s: text not in normal form settles after one round trip', async (file) => {
    for (const [index, { name, xml }] of (await corpusComponents(file)).entries()) {
      const where = `${file}, component ${name}`
      const text = roughen(decorate(generator.generate(xml), 2000 + index))
      const first = parser.parse(text, { componentName: name })
      expect(first.errors, `${where}\n${text}`).toEqual([])

      const once = generator.generate(first.xml!, { layout: first.layout })
      const second = parser.parse(once, { componentName: name })
      expect(second.xml, where).toBe(first.xml)
      expect(generator.generate(second.xml!, { layout: second.layout }), where).toBe(once)
      expect(commentsIn(once).sort(), where).toEqual(commentsIn(text).map((c) => c.trimEnd()).sort())
    }
  }, 60_000)
})
