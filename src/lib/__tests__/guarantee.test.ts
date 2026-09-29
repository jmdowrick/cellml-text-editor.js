// @vitest-environment jsdom
// jsdom, because happy-dom 20 never frees a document once it has been queried, and this test parses thousands.

/**
 * The guarantee: no successful parse emits math that isn't valid CellML 2.0.
 * Every successful parse below is checked against libcellml's Validator and the
 * CellML MathML subset.
 */
import { describe, expect, test } from 'vitest'

import { CellMLTextGenerator } from '../CellMLTextGenerator'
import { CellMLTextParser } from '../CellMLTextParser'
import { CORPUS_FILES, corpusComponents } from './helpers/corpus'
import { ALL_CASES } from './helpers/fixtures'
import { mathIssues } from './helpers/libcellml'
import { modelWithRhs, rhs } from './helpers/mathml'
import { randomTokenSoups, randomTrees } from './helpers/random'

const parser = new CellMLTextParser({ simplified: true, sourceLineAttribute: null })
const generator = new CellMLTextGenerator({ simplified: true })

async function expectValid(text: string) {
  const result = parser.parse(text)
  expect(result.errors, text).toEqual([])
  expect(await mathIssues(result.xml!), text).toEqual([])
}

describe('every successful parse is valid CellML', () => {
  test('the checker catches what 0.3.1 wrote', async () => {
    const legacy = modelWithRhs('(sqrt x)')
    expect(await mathIssues(legacy)).toContain('<sqrt> is not in the CellML 2.0 MathML subset')
  })

  test.each(ALL_CASES)('unit-test input: $text', async ({ text }) => {
    await expectValid(`y = ${text};`)
  })

  test.each(CORPUS_FILES)('corpus: %s', async (file) => {
    for (const { name, xml } of await corpusComponents(file)) {
      const result = new CellMLTextParser({ simplified: true, sourceLineAttribute: null }).parse(
        generator.generateResult(xml).text,
        { componentName: name },
      )
      expect(result.errors, `${file}, component ${name}`).toEqual([])
      expect(await mathIssues(result.xml!), `${file}, component ${name}`).toEqual([])
    }
  })

  test('random trees: tree -> text -> tree is the identity, and valid', async () => {
    for (const tree of randomTrees(20260929, 400)) {
      const result = generator.generateResult(modelWithRhs(tree))
      expect(result.errors, tree).toEqual([])
      const text = result.text.trimEnd()
      expect(rhs(text.slice('y = '.length, -1)), `${tree}\n${text}`).toBe(tree)
      await expectValid(text)
    }
  }, 60_000)

  test('random token soups: whatever parses is valid', async () => {
    let parsed = 0
    for (const soup of randomTokenSoups(42, 5000)) {
      const text = `y = ${soup};`
      const result = parser.parse(text)
      if (result.errors.length > 0) continue
      parsed++
      expect(await mathIssues(result.xml!), text).toEqual([])
    }
    // Enough of the soups parse for the test to mean something.
    expect(parsed).toBeGreaterThan(50)
  }, 60_000)
})
