import { CellMLTextParser } from '../../CellMLTextParser'
import { MATHML_NS } from '../../CellMLMathML'

/** The cellml:units of a <cn>, whatever prefix it was written with. */
export function unitsOf(cn: Element): string | undefined {
  const attr = Array.from(cn.attributes).find((a) => a.name === 'units' || a.name.endsWith(':units'))
  return attr?.value
}

/**
 * A compact, whitespace-free spelling of a MathML tree, for comparing trees and
 * writing expectations, e.g. `(root (degree 3) x)`. Constants print as `#pi`,
 * e-notation as `1E-3`, and units other than dimensionless as `2{mV}`.
 */
export function sexpr(node: Element): string {
  const tag = node.localName
  if (tag === 'ci') return node.textContent?.trim() ?? ''
  if (tag === 'cn') {
    const value =
      node.getAttribute('type') === 'e-notation'
        ? Array.from(node.childNodes)
            .map((c) => (c.nodeType === 1 ? 'E' : (c.textContent?.trim() ?? '')))
            .join('')
        : (node.textContent?.trim() ?? '')
    const units = unitsOf(node)
    return units && units !== 'dimensionless' ? `${value}{${units}}` : value
  }

  const children = Array.from(node.children)
  if (tag === 'apply') {
    // <sqrt/> is the legacy spelling of <root/>.
    const op = children[0]?.localName === 'sqrt' ? 'root' : (children[0]?.localName ?? '?')
    return `(${[op, ...children.slice(1).map(sexpr)].join(' ')})`
  }
  if (children.length === 0) return `#${tag}`
  return `(${[tag, ...children.map(sexpr)].join(' ')})`
}

/** Every equation in a document, in order, as sexpr strings. */
export function equationsOf(doc: Document | Element): string[] {
  return Array.from(doc.getElementsByTagNameNS(MATHML_NS, 'math')).flatMap((math) =>
    Array.from(math.children).map(sexpr),
  )
}

const simpleParser = new CellMLTextParser({ simplified: true, sourceLineAttribute: null })

/** Parses Simple Mode text, throwing on a parse error. */
export function parseSimple(text: string): { xml: string; doc: XMLDocument } {
  const result = simpleParser.parse(text)
  if (!result.xml || !result.doc) throw new Error(`Parse failed: ${JSON.stringify(result.errors)}`)
  return { xml: result.xml, doc: result.doc }
}

/** The right-hand side of `y = <expression>;`, as a sexpr string. */
export function rhs(expression: string): string {
  const [equation] = equationsOf(parseSimple(`y = ${expression};`).doc)
  const prefix = '(eq y '
  if (!equation?.startsWith(prefix)) throw new Error(`Unexpected equation ${equation}`)
  return equation.slice(prefix.length, -1)
}

/** The parse error for Simple Mode text, or undefined if it parses. */
export function parseError(text: string): string | undefined {
  return simpleParser.parse(text).errors[0]?.message
}

/** Wraps MathML content in a CellML 2.0 model with one component. */
export function modelWith(mathContent: string, name = 'c'): string {
  return (
    `<model xmlns="http://www.cellml.org/cellml/2.0#" xmlns:cellml="http://www.cellml.org/cellml/2.0#" name="m">` +
    `<component name="${name}"><math xmlns="${MATHML_NS}">${mathContent}</math></component></model>`
  )
}

/**
 * MathML from the sexpr spelling, e.g. `(root (degree 3) x)`. Words are <ci>,
 * numbers are <cn> (dimensionless unless written `2{mV}`), `#pi` is <pi/>, and
 * `(degree …)`, `(logbase …)`, `(bvar …)`, `(piecewise …)`, `(piece …)` and
 * `(otherwise …)` are elements rather than applies.
 */
export function fromSexpr(source: string): string {
  const tokens = source.match(/\(|\)|[^\s()]+/g) ?? []
  let pos = 0
  const ELEMENTS = new Set(['degree', 'logbase', 'bvar', 'piecewise', 'piece', 'otherwise'])

  function node(): string {
    const token = tokens[pos++]
    if (token === undefined) throw new Error(`Unexpected end of ${source}`)
    if (token === '(') {
      const head = tokens[pos++]!
      const children: string[] = []
      while (tokens[pos] !== ')') children.push(node())
      pos++
      return ELEMENTS.has(head) ? `<${head}>${children.join('')}</${head}>` : `<apply><${head}/>${children.join('')}</apply>`
    }
    if (token.startsWith('#')) return `<${token.slice(1)}/>`

    const number = token.match(/^(-?[\d.]+)(?:E([+-]?\d+))?(?:\{(\w+)\})?$/)
    if (number) {
      const [, mantissa, exponent, units = 'dimensionless'] = number
      return exponent === undefined
        ? `<cn cellml:units="${units}">${mantissa}</cn>`
        : `<cn cellml:units="${units}" type="e-notation">${mantissa}<sep/>${exponent}</cn>`
    }
    return `<ci>${token}</ci>`
  }

  const result = node()
  if (pos !== tokens.length) throw new Error(`Trailing input in ${source}`)
  return result
}

/** A model whose only equation is `y = <expression>`. */
export function modelWithRhs(expression: string): string {
  return modelWith(`<apply><eq/><ci>y</ci>${fromSexpr(expression)}</apply>`)
}
