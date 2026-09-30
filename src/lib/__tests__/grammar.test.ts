import { expect, test } from 'vitest'

import { parser } from '../../grammar/parser'

/** The node names of the editor's syntax tree, for highlighting (not the parser behind the XML). */
function nodes(text: string): string[] {
  const names: string[] = []
  parser.parse(text).iterate({ enter: (node) => void names.push(node.name) })
  return names
}

test('comments are highlighted as comments, and add no errors', () => {
  const plain = 'def comp c as\n  y = a / b;\nenddef;\n'
  const commented = 'def comp c as  // c\n  // note\n  y = a / b;  // tail\nenddef;\n'
  const errors = (names: string[]) => names.filter((n) => n === '⚠').length

  expect(nodes(commented).filter((n) => n === 'Comment')).toHaveLength(3)
  expect(errors(nodes(commented))).toBe(errors(nodes(plain)))
  // `//` is a comment, but `/` is still division.
  expect(nodes(commented)).toContain('Operator')
})
