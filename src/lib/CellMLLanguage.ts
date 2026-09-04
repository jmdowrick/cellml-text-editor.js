import { parser } from '../grammar/parser'
import { cellmlHighlight } from '../grammar/highlight'
import {
  LRLanguage,
  LanguageSupport,
  foldNodeProp,
  foldInside,
  indentNodeProp,
  delimitedIndent,
  indentUnit,
} from '@codemirror/language'

const enddefBlockIndent = (context: any) => {
  const baseIndent = context.column(context.node.from)
  const lineText = context.textAfter.trim()
  if (/^enddef(;)?/.test(lineText)) return baseIndent
  return baseIndent + context.unit
}

const cellmlParser = parser.configure({
  props: [
    cellmlHighlight,

    foldNodeProp.add({
      Definition: foldInside,
      SimpleComponent: foldInside,
      Model: foldInside,
      Units: foldInside,
      Annotations: foldInside,
    }),

    indentNodeProp.add({
      SimpleComponent: (context) => {
        const baseIndent = context.column(context.node.from)
        const lineText = context.textAfter.trim()
        if (lineText.startsWith('}')) {
          return baseIndent
        }
        return baseIndent + context.unit
      },

      Definition: enddefBlockIndent,
      Model: enddefBlockIndent,
      Units: delimitedIndent({ closing: '}' }),
      Annotations: delimitedIndent({ closing: '}' }),
      ParenExpression: delimitedIndent({ closing: ')' }),
    }),
  ],
})

export const cellmlLanguage = LRLanguage.define({
  parser: cellmlParser,
  languageData: {
    commentTokens: { line: '//' },
    indentOnInput: /^\s*(enddef;?|\})$/,
  },
})

export function cellml() {
  return new LanguageSupport(cellmlLanguage, [
    indentUnit.of('  '), // Forces 1 indentation step to strictly equal 2 spaces
  ])
}
