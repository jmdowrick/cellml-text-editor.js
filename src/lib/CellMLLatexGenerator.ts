import { PRECEDENCE, lookup } from './CellMLMathML'

// On top of the shared precedence table: powers bind tighter than any infix
// operator, and function calls are visually self-contained.
const POWER_PRECEDENCE = 80
const FUNCTION_PRECEDENCE = 90

/** Children of an <apply> that qualify the operator rather than being operands. */
const QUALIFIERS = new Set(['bvar', 'degree', 'logbase'])

/** Functions KaTeX has a macro for, e.g. \sin. The rest are written with \operatorname. */
const LATEX_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'coth',
  'arcsin', 'arccos', 'arctan', 'ln', 'log', 'min', 'max',
])
const OPERATOR_NAMES = new Set([
  'rem', 'sech', 'csch', 'arcsec', 'arccsc', 'arccot',
  'arcsinh', 'arccosh', 'arctanh', 'arcsech', 'arccsch', 'arccoth',
])

const CONSTANTS: Record<string, string> = {
  pi: '\\pi',
  exponentiale: 'e',
  infinity: '\\infty',
  notanumber: '\\mathrm{NaN}',
  true: '\\mathrm{true}',
  false: '\\mathrm{false}',
}

export class CellMLLatexGenerator {
  public convert(mathMLNode: Element): string {
    if (!mathMLNode) return ''

    // Handle the <math> wrapper.
    if (mathMLNode.localName === 'math') {
      // If there are multiple equations, we will map over them.
      return Array.from(mathMLNode.children)
        .map((child: Element) => this.convert(child)) // Recursively convert each equation
        .join('\n')
    }

    // Intercept Top-Level Assignments
    // We check specifically for an <apply> block where the operator is <eq/>
    if (mathMLNode.localName === 'apply' && mathMLNode.firstElementChild?.localName === 'eq') {
      const children = Array.from(mathMLNode.children)

      // Skip the operator (index 0)
      const lhs = this.parseNode(children[1])
      const rhs = this.parseNode(children[2])

      return `${lhs} = ${rhs}`
    }

    //  Handle everything else (Expressions)
    return this.parseNode(mathMLNode)
  }

  private ignoreTag(tag: string): Boolean {
    const ignoreNodes = ['bvar']
    return ignoreNodes.includes(tag)
  }

  private parseNode(node: Element | null | undefined, contextPrecedence: number = 0): string {
    if (!node) return ''
    const tag = node.localName

    if (tag === 'apply') return this.parseApply(node, contextPrecedence)
    if (tag === 'ci') return this.parseIdentifier(node.textContent || '')
    if (tag === 'cn') {
      const type = node.getAttribute('type')
      if (type === 'e-notation') {
        const children = Array.from(node.childNodes)
        const sepIndex = children.findIndex((c) => c.nodeType === 1 && (c as Element).localName === 'sep')

        if (sepIndex !== -1) {
          const mantissa = children
            .slice(0, sepIndex)
            .map((c) => c.textContent)
            .join('')
            .trim()
          const exponent = children
            .slice(sepIndex + 1)
            .map((c) => c.textContent)
            .join('')
            .trim()

          return `${mantissa} \\times 10^{${exponent}}`
        }
      }

      const text = node.textContent?.trim() || '0'
      if (text.match(/^-?[\d.]+[eE][+-]?\d+$/)) {
        const [mant, exp] = text.split(/[eE]/)
        return `${mant} \\times 10^{${exp}}`
      }
      return text
    }
    if (tag === 'piecewise') return this.parsePiecewise(node)
    const constant = lookup(CONSTANTS, tag)
    if (constant) return constant
    if (this.ignoreTag(tag)) return ''

    console.warn(`Unsupported MathML node: ${tag}`)
    return ''
  }

  private escapeGreek(text: string): string {
    const greek = [
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      'zeta',
      'eta',
      'theta',
      'iota',
      'kappa',
      'lambda',
      'mu',
      'nu',
      'xi',
      'omicron',
      'pi',
      'rho',
      'sigma',
      'tau',
      'upsilon',
      'phi',
      'chi',
      'psi',
      'omega',
    ]
    return greek.includes(text.toLowerCase()) ? `\\${text}` : text
  }

  /**
   * Specialized identifier formatter.
   * Format: Base_Sub_Super_SubOfSuper
   * Example: v_AQ_api_i -> v_{AQ}^{api_{i}}
   */
  private parseIdentifier(name: string): string {
    // Handle simple cases (no underscores)
    if (!name.includes('_')) {
      return this.escapeGreek(name)
    }

    const parts = name.split('_')

    // Base (e.g. 'v')
    const base = this.escapeGreek(parts[0] || '')

    const subParts = []
    if (parts[1]) subParts.push(parts[1])
    if (parts.length > 4) subParts.push(...parts.slice(4))

    let superBlock = ''
    if (parts.length === 3 && (parts[2] || []).length === 1) {
      subParts.push(this.escapeGreek(parts[2] || ''))
    } else if (parts[2]) {
      superBlock = this.escapeGreek(parts[2])
      if (parts[3]) {
        superBlock += `_{${this.escapeGreek(parts[3])}}`
      }
    }
    subParts.forEach((part, index) => {
      subParts[index] = this.escapeGreek(part)
    })
    const subBlock = subParts.join(',')

    let latex = base

    if (subBlock) {
      latex += `_{${subBlock}}`
    }

    if (superBlock) {
      latex += `^{${superBlock}}`
    }

    return latex
  }

  private parseApply(node: Element | null | undefined, parentPrecedence: number): string {
    const children = Array.from(node?.children || [])
    const op = children[0]?.localName || 'unknown'
    const myPrecedence = lookup(PRECEDENCE, op) ?? (op === 'power' ? POWER_PRECEDENCE : FUNCTION_PRECEDENCE)
    const operands = children.slice(1).filter((c) => !QUALIFIERS.has(c.localName))
    const qualifier = (name: string) => children.find((c) => c.localName === name)?.firstElementChild ?? undefined
    const args = operands.map((c, index) => {
      let childExpectedPrec = myPrecedence
      // Special cases for child precedence.
      if (myPrecedence === FUNCTION_PRECEDENCE || op === 'divide') {
        childExpectedPrec = 0 // Self-contained: \frac{}{}, \sqrt{}, \sin\left(\right)
      } else if (op === 'minus' && (index === 1 || operands.length === 1)) {
        // Right operand of subtraction, or the operand of a negation: -(a + b).
        childExpectedPrec = myPrecedence + 1
      }
      return this.parseNode(c, childExpectedPrec)
    })

    let latex = ''
    switch (op) {
      case 'plus':
        latex = args.join(' + ')
        break
      case 'minus':
        latex = args.length === 1 ? `-${args[0]}` : `${args[0]} - ${args[1]}`
        break
      case 'times':
        latex = args.join(' \\cdot ')
        break
      case 'divide':
        latex = `\\frac{${args[0]}}{${args[1]}}`
        break
      case 'eq':
        latex = `${args[0]} == ${args[1]}`
        break
      case 'neq':
        latex = `${args[0]} \\neq ${args[1]}`
        break
      case 'lt':
        latex = `${args[0]} < ${args[1]}`
        break
      case 'leq':
        latex = `${args[0]} \\leq ${args[1]}`
        break
      case 'gt':
        latex = `${args[0]} > ${args[1]}`
        break
      case 'geq':
        latex = `${args[0]} \\geq ${args[1]}`
        break
      case 'and':
        latex = args.join(' \\land ')
        break
      case 'or':
        latex = args.join(' \\lor ')
        break
      case 'power':
        // Look at the original DOM node for the base (the first argument)
        const baseNode = children[1]
        const baseString = args[0] || ''
        const expString = args[1]

        // Check if atomic
        const isAtomic =
          baseNode?.localName === 'ci' || (baseNode?.localName === 'cn' && !baseString.trim().startsWith('-'))

        latex = isAtomic ? `{${baseString}}^{${expString}}` : `\\left({${baseString}}\\right)^{${expString}}`
        break
      case 'root':
      case 'sqrt': {
        // <sqrt/> isn't CellML, but is still read from older models.
        const degree = qualifier('degree')
        latex = degree ? `\\sqrt[${this.parseNode(degree)}]{${args[0]}}` : `\\sqrt{${args[0]}}`
        break
      }
      case 'log': {
        const base = qualifier('logbase')
        latex = base ? `\\log_{${this.parseNode(base)}}\\left(${args[0]}\\right)` : `\\log\\left(${args[0]}\\right)`
        break
      }
      case 'diff': {
        // <diff/> <bvar>t</bvar> V  --> \frac{dV}{dt}
        const bvar = children.find((c) => c.localName === 'bvar')
        const indep = bvar ? Array.from(bvar.children).find((c) => c.localName === 'ci') : undefined
        const degreeNode = bvar ? Array.from(bvar.children).find((c) => c.localName === 'degree') : undefined
        const indepStr = indep ? this.parseNode(indep) : 'x'
        const depStr = args[0] ?? 'y'
        const order = degreeNode?.firstElementChild ? this.parseNode(degreeNode.firstElementChild) : ''
        latex = order
          ? `\\frac{d^{${order}}${depStr}}{d${indepStr}^{${order}}}`
          : `\\frac{d${depStr}}{d${indepStr}}`
        break
      }
      // Trig & Funcs
      case 'exp':
        latex = `e^{${args[0]}}`
        break
      case 'abs':
        latex = `\\left|${args[0]}\\right|`
        break
      case 'floor':
        latex = `\\lfloor ${args[0]} \\rfloor`
        break
      case 'ceiling':
        latex = `\\lceil ${args[0]} \\rceil`
        break
      case 'not':
        latex = `\\lnot\\left(${args[0]}\\right)`
        break
      case 'xor':
        latex = args.map((a) => `\\left(${a}\\right)`).join(' \\oplus ')
        break

      default:
        if (LATEX_FUNCTIONS.has(op)) {
          latex = `\\${op}\\left(${args.join(', ')}\\right)`
        } else if (OPERATOR_NAMES.has(op)) {
          latex = `\\operatorname{${op}}\\left(${args.join(', ')}\\right)`
        } else {
          console.log(`Unsupported MathML operator: ${op}`)
          latex = `\\text{${op}}(${args.join(', ')})`
        }
        break
    }

    if (myPrecedence < parentPrecedence) {
      latex = `\\left(${latex}\\right)`
    }

    return latex
  }

  private parsePiecewise(node: Element): string {
    let content = ''
    const children = Array.from(node.children)
    children.forEach((child) => {
      if (child.localName === 'piece') {
        const val = this.parseNode(child.children[0])
        const cond = this.parseNode(child.children[1])
        content += `${val} & \\text{if } ${cond} \\\\ `
      } else if (child.localName === 'otherwise') {
        const val = this.parseNode(child.children[0])
        content += `${val} & \\text{otherwise}`
      }
    })
    return `\\begin{cases} ${content} \\end{cases}`
  }
}
