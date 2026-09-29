import {
  ATOMIC_PRECEDENCE,
  CELLML_NS as CELLML_2_0_NS,
  COMPARISON_PRECEDENCE,
  CONSTANT_TEXT,
  FLATTENING_OPERATORS,
  FUNCTIONS,
  MATHML_NS,
  PRECEDENCE,
  RESERVED_NAMES,
  UNARY_PRECEDENCE,
  isCellMLBasicReal,
  isCellMLIdentifier,
  isCellMLInteger,
  isCellMLReal,
  lookup,
} from './CellMLMathML'

/** Children of an <apply> that qualify the operator rather than being operands. */
const QUALIFIERS = new Set(['bvar', 'degree', 'logbase'])

export interface CellMLTextGeneratorOptions {
  tabSize?: number
  simplified?: boolean
}

/** Something in the XML that the text can't hold, so editing the text would lose it. */
export interface GeneratorError {
  message: string
  /** Where it is, e.g. /model/component[@name='x']/math[1]/apply[3]. */
  path?: string
}

export interface GeneratorResult {
  text: string
  errors: GeneratorError[]
}

export class CellMLTextGenerator {
  private output: string = ''
  private errors: GeneratorError[] = []
  private indentLevel: number = 0
  private domParser: DOMParser
  private standardIndent: string = '  '
  public simplified: boolean = true

  constructor(options: CellMLTextGeneratorOptions = {}) {
    if (options.tabSize) {
      this.standardIndent = ' '.repeat(options.tabSize)
    }
    this.simplified = options.simplified ?? true
    this.domParser = new DOMParser()
  }

  // --- Helper: Indentation ---
  private indent(): string {
    return this.standardIndent.repeat(this.indentLevel)
  }

  private append(str: string, newLine: boolean = true) {
    this.output += (newLine ? this.indent() : '') + str + (newLine ? '\n' : '')
  }

  // --- Main Entry Point ---

  /** The text for a CellML 2.0 model. Use generateResult() to also learn what couldn't be written. */
  public generate(xmlString: string): string {
    return this.generateResult(xmlString).text
  }

  /**
   * The text for a CellML 2.0 model, and everything in its math that the text
   * can't hold. When `errors` is not empty, editing and re-parsing the text would
   * lose or change those parts, so the text marks each one (`#unsupported:…#`)
   * and won't parse until they are removed.
   */
  public generateResult(xmlString: string): GeneratorResult {
    this.output = ''
    this.errors = []
    this.indentLevel = 0

    try {
      const doc = this.domParser.parseFromString(xmlString, 'application/xml')
      const errorNode = doc.querySelector('parsererror')
      if (errorNode) throw new Error('XML Parsing Error')

      const model = doc.getElementsByTagNameNS(CELLML_2_0_NS, 'model')[0]
      if (!model) throw new Error('No CellML 2.0 Model found')

      this.processModel(model)
    } catch (e: any) {
      const message = `Error generating text: ${e.message}`
      return { text: `// ${message}`, errors: [{ message }] }
    }

    return { text: this.output, errors: this.errors }
  }

  // --- Recursive Processors ---

  private processModel(model: Element) {
    const name = model.getAttribute('name') || 'unnamed_model'
    if (!this.simplified) {
      this.append(`def model ${name} as`)
      this.indentLevel++

      // 1. Process Units (not representable in Simple Mode)
      const units = model.getElementsByTagName('units')
      for (let i = 0; i < units.length; i++) {
        // Only process units that are direct children of model
        if (units[i]?.parentElement === model) this.processUnits(units[i])
      }
    }

    // 2. Process Components. The editor works on one component at a time, so
    // Simple Mode shows just the first.
    const components = Array.from(model.getElementsByTagName('component'))
    const shown = this.simplified ? components.slice(0, 1) : components

    for (const component of shown) {
      this.processComponent(component)
    }

    // Ensure single newline after last component.
    this.output = this.output.trimEnd() + '\n'

    if (!this.simplified) {
      this.indentLevel--
      this.append(`enddef;`)
    }
  }

  private processUnits(unit: Element | null | undefined) {
    const name = unit?.getAttribute('name') || 'unnamed_units'
    this.append(`def unit ${name} as`)
    this.indentLevel++

    const children = unit?.getElementsByTagName('unit') || []
    for (let i = 0; i < children.length; i++) {
      const u = children[i]
      if (!u) continue
      const prefix = u.getAttribute('prefix')
      const unitsRef = u.getAttribute('units')
      const exponent = u.getAttribute('exponent')
      const multiplier = u.getAttribute('multiplier')

      let line = `unit ${unitsRef}`
      if (prefix) line += ` {prefix: ${prefix}}`
      if (exponent) line += ` {exponent: ${exponent}}`
      if (multiplier) line += ` {multiplier: ${multiplier}}`
      line += ';'

      this.append(line)
    }

    this.indentLevel--
    this.append(`enddef;`)
    this.append('') // Spacer
  }

  private processComponent(component: Element | null | undefined) {
    if (this.simplified) {
      this.processComponentMath(component)
      return
    }

    const name = component?.getAttribute('name') || 'unnamed_component'
    this.append(`def comp ${name} as`)
    this.indentLevel++

    const vars = component?.getElementsByTagName('variable') || []
    for (let i = 0; i < vars.length; i++) {
      this.processVariable(vars[i])
    }

    this.processComponentMath(component)

    this.indentLevel--
    this.append('enddef;\n')
  }

  private processComponentMath(component: Element | null | undefined) {
    const maths = component?.getElementsByTagNameNS(MATHML_NS, 'math') || []
    for (let i = 0; i < maths.length; i++) {
      this.processMath(maths[i])
    }
  }

  private processVariable(v: Element | null | undefined) {
    const name = v?.getAttribute('name')
    const units = v?.getAttribute('units')
    const initial = v?.getAttribute('initial_value')
    const inf = v?.getAttribute('interface') || 'public'
    let line = `var ${name}: ${units}`
    let attributes = []

    if (initial) attributes.push(`init: ${initial}`)

    if (inf) attributes.push(`interface: ${inf}`)

    if (attributes.length > 0) {
      line += ` {${attributes.join(', ')}}`
    }
    line += ';'
    this.append(line)
  }

  // --- MathML Handling ---

  private processMath(math: Element | null | undefined) {
    if (!math) return
    const mathMarker = this.attributeMarker(math)
    if (mathMarker) this.append(`${mathMarker};`)

    for (const child of Array.from(math.children)) {
      const operands = this.operandsOf(child)
      if (child.localName === 'apply' && child.firstElementChild?.localName === 'eq' && operands.length === 2) {
        const marker = this.attributeMarker(child) + this.attributeMarker(child.firstElementChild)
        const [lhs, rhs] = operands
        this.append(`${marker}${this.printArgument(lhs!, 'expression')} = ${this.printArgument(rhs!, 'expression')};`)
      } else {
        // Only equations can be written as a statement.
        this.append(`${this.unsupported(child, 'The top level of <math> can only hold equations (<apply><eq/>…</apply>)')};`)
      }
    }
  }

  /** Records that `node` can't be printed, and returns text the parser rejects in its place. */
  private unsupported(node: Element, message: string): string {
    this.errors.push({ message, path: this.pathOf(node) })
    return `#unsupported:${node.localName}#`
  }

  /** An XPath-style location, e.g. /model/component[@name='x']/math[1]/apply[3]. */
  private pathOf(node: Element): string {
    const steps: string[] = []
    for (let el: Element | null = node; el; el = el.parentElement) {
      const name = el.getAttribute('name')
      if (el.parentElement === null) {
        steps.unshift(el.localName)
      } else if (name !== null && (el.localName === 'component' || el.localName === 'units')) {
        steps.unshift(`${el.localName}[@name='${name}']`)
      } else {
        const siblings = Array.from(el.parentElement.children).filter((c) => c.localName === el!.localName)
        steps.unshift(`${el.localName}[${siblings.indexOf(el) + 1}]`)
      }
    }
    return '/' + steps.join('/')
  }

  /**
   * Attributes on math elements that the text has no way to write down are
   * reported, and marked in the text like unsupported elements. Returns the markers.
   */
  private attributeMarker(node: Element): string {
    let markers = ''
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name
      if (name === 'xmlns' || name.startsWith('xmlns:') || name.startsWith('data-')) continue
      if (node.localName === 'cn' && (name === 'type' || name === 'units' || name.endsWith(':units'))) continue
      this.errors.push({
        message: `The attribute '${name}' on <${node.localName}> can't be written in CellML Text`,
        path: this.pathOf(node),
      })
      markers += `#unsupported:@${name}# `
    }
    return markers
  }

  // --- Brackets ---

  private precedenceOf(node: Element): number {
    if (node.localName !== 'apply') return ATOMIC_PRECEDENCE
    const op = node.firstElementChild?.localName ?? ''
    if ((op === 'minus' || op === 'plus') && this.operandsOf(node).length === 1) return UNARY_PRECEDENCE
    return lookup(PRECEDENCE, op) ?? ATOMIC_PRECEDENCE
  }

  private operatorOf(node: Element): string | undefined {
    return node.localName === 'apply' ? node.firstElementChild?.localName : undefined
  }

  /** The children of an apply after the operator, leaving out the qualifiers. */
  private operandsOf(node: Element): Element[] {
    return Array.from(node.children)
      .slice(1)
      .filter((c) => !QUALIFIERS.has(c.localName))
  }

  /**
   * Prints an operand of an infix operator, bracketed only when the text would
   * otherwise parse to a different tree (or, for mixed and/or, read ambiguously).
   */
  private printOperand(child: Element, parentOp: string, index: number): string {
    const text = this.parseMathNode(child)
    const childPrec = this.precedenceOf(child)
    const parentPrec = lookup(PRECEDENCE, parentOp) ?? ATOMIC_PRECEDENCE
    const childOp = this.operatorOf(child)

    let bracket = childPrec < parentPrec
    if (childPrec === parentPrec) {
      if (index > 0) bracket = true // a - (b - c), a / (b * c), a + (b - c)
      else if (childOp === parentOp && FLATTENING_OPERATORS.has(parentOp)) bracket = true // (a + b) + c
      else if (parentPrec === COMPARISON_PRECEDENCE) bracket = true // (a < b) == c
    }
    if ((parentOp === 'and' && childOp === 'or') || (parentOp === 'or' && childOp === 'and')) bracket = true

    return bracket ? `(${text})` : text
  }

  /**
   * Prints a function argument, equation side or piece value. Those are parsed as
   * arithmetic, so conditions there need brackets; condition slots don't.
   */
  private printArgument(child: Element, slot: 'expression' | 'condition'): string {
    const text = this.parseMathNode(child)
    return slot === 'expression' && this.precedenceOf(child) < PRECEDENCE.plus! ? `(${text})` : text
  }

  // --- Nodes ---

  private parseMathNode(node: Element): string {
    return this.attributeMarker(node) + this.printNode(node)
  }

  private printNode(node: Element): string {
    const tag = node.localName

    if (tag === 'apply') {
      return this.parseApply(node)
    } else if (tag === 'ci') {
      const name = node.textContent?.trim() || ''
      if (!isCellMLIdentifier(name)) return this.unsupported(node, `'${name}' is not a valid variable name`)
      if (RESERVED_NAMES.has(name)) {
        return this.unsupported(node, `The variable '${name}' can't be written in CellML Text, because '${name}' is a reserved word`)
      }
      return name
    } else if (tag === 'cn') {
      return this.parseNumber(node)
    } else if (tag === 'piecewise') {
      return this.parsePiecewise(node)
    }

    const constant = lookup(CONSTANT_TEXT, tag)
    if (constant && node.children.length === 0) return constant

    return this.unsupported(node, `<${tag}> is not supported in CellML Text`)
  }

  private parseNumber(node: Element): string {
    const type = node.getAttribute('type')
    let value: string

    if (type === 'e-notation') {
      const children = Array.from(node.childNodes)
      const sepIndex = children.findIndex((c) => c.nodeType === 1 && (c as Element).localName === 'sep')
      const text = (nodes: ChildNode[]) =>
        nodes
          .map((c) => c.textContent)
          .join('')
          .trim()
      const mantissa = text(children.slice(0, sepIndex))
      const exponent = text(children.slice(sepIndex + 1))

      if (sepIndex === -1 || !isCellMLBasicReal(mantissa) || !isCellMLInteger(exponent)) {
        return this.unsupported(node, `The e-notation number '${node.textContent?.trim()}' is not valid`)
      }
      value = `${mantissa}e${exponent}`
    } else if (type === null || type === 'real') {
      value = node.textContent?.trim() || ''
      // A plain <cn> with an exponent isn't valid CellML, but the parser rewrites it as e-notation.
      if (!isCellMLReal(value)) return this.unsupported(node, `The number '${value}' is not valid`)
    } else {
      return this.unsupported(node, `Numbers of type '${type}' are not supported in CellML Text`)
    }

    // Extract units attribute across namespace variants
    const units =
      node.getAttributeNS(CELLML_2_0_NS, 'units') || node.getAttribute('cellml:units') || node.getAttribute('units')

    // Suppress {units: dimensionless} ONLY in simple mode
    if (units && !(this.simplified && units === 'dimensionless')) {
      return `${value} {${units}}`
    }
    return value
  }

  private parseApply(applyNode: Element): string {
    // Attributes on the operator and qualifiers, which aren't printed through parseMathNode.
    const parts = Array.from(applyNode.children).filter((c, i) => i === 0 || QUALIFIERS.has(c.localName))
    const degrees = parts.filter((c) => c.localName === 'bvar').flatMap((b) => Array.from(b.children).filter((c) => c.localName === 'degree'))
    return [...parts, ...degrees].map((c) => this.attributeMarker(c)).join('') + this.printApply(applyNode)
  }

  private printApply(applyNode: Element): string {
    const children = Array.from(applyNode.children)
    const opNode = children[0]
    if (!opNode) return this.unsupported(applyNode, 'An empty <apply> can\'t be written in CellML Text')
    const op = opNode.localName
    if (opNode.children.length > 0 || opNode.localName === 'ci' || opNode.localName === 'apply') {
      return this.unsupported(opNode, `<${op}> can't be used as an operator in CellML Text`)
    }

    const operands = this.operandsOf(applyNode)
    const qualifiers = children.slice(1).filter((c) => QUALIFIERS.has(c.localName))
    const allowed = op === 'root' ? ['degree'] : op === 'log' ? ['logbase'] : op === 'diff' ? ['bvar'] : []
    for (const qualifier of qualifiers) {
      const repeated = qualifiers.filter((q) => q.localName === qualifier.localName).length > 1
      const wrongShape = qualifier.localName !== 'bvar' && qualifier.children.length !== 1
      if (!allowed.includes(qualifier.localName) || repeated || wrongShape) {
        return this.unsupported(qualifier, `<${qualifier.localName}> is not supported here in <apply><${op}/>…</apply>`)
      }
    }
    const qualifier = (name: string) => qualifiers.find((q) => q.localName === name)?.firstElementChild ?? undefined

    const arity = (min: number, max: number) => {
      if (operands.length < min || operands.length > max) {
        const count = max === Infinity ? `${min} or more` : min === max ? `${min}` : `${min} or ${max}`
        return this.unsupported(applyNode, `<${op}> needs ${count} operand${max === 1 ? '' : 's'}, but has ${operands.length}`)
      }
      return null
    }
    const infix = (symbol: string, min: number, max: number) =>
      arity(min, max) ?? operands.map((c, i) => this.printOperand(c, op, i)).join(` ${symbol} `)

    // Operator Mapping
    const prefix = (symbol: string) => {
      const operand = operands[0]!
      const text = this.parseMathNode(operand)
      return this.precedenceOf(operand) < ATOMIC_PRECEDENCE ? `${symbol}(${text})` : `${symbol}${text}`
    }

    switch (op) {
      case 'plus':
        return operands.length === 1 ? prefix('+') : infix('+', 2, Infinity)
      case 'times':
        return infix('*', 2, Infinity)
      case 'divide':
        return infix('/', 2, 2)
      case 'minus':
        return operands.length === 1 ? prefix('-') : infix('-', 2, 2)
      case 'and':
        return infix('and', 2, Infinity)
      case 'or':
        return infix('or', 2, Infinity)
      case 'eq':
        return infix('==', 2, 2)
      case 'neq':
        return infix('!=', 2, 2)
      case 'lt':
        return infix('<', 2, 2)
      case 'leq':
        return infix('<=', 2, 2)
      case 'gt':
        return infix('>', 2, 2)
      case 'geq':
        return infix('>=', 2, 2)

      case 'diff': {
        // <diff/> <bvar><ci>t</ci><degree>n</degree></bvar> <ci>V</ci> -> ode(V, t, n)
        const bvar = qualifiers.find((q) => q.localName === 'bvar')
        const bvarChildren = Array.from(bvar?.children ?? [])
        const variable = bvarChildren.find((c) => c.localName === 'ci')
        const degree = bvarChildren.find((c) => c.localName === 'degree')
        const unexpected = bvarChildren.find((c) => c !== variable && c !== degree)
        if (!bvar || !variable || unexpected || (degree && degree.children.length !== 1)) {
          return this.unsupported(bvar ?? applyNode, 'A derivative needs a <bvar> holding one <ci>, and optionally a <degree>')
        }
        const error = arity(1, 1)
        if (error) return error
        const args = [this.printArgument(operands[0]!, 'expression'), this.parseMathNode(variable)]
        if (degree) args.push(this.printArgument(degree.firstElementChild!, 'expression'))
        return `ode(${args.join(', ')})`
      }

      case 'root':
      case 'sqrt': {
        // <sqrt/> isn't CellML; it is read so that re-parsing migrates it to <root/>.
        const error = arity(1, 1)
        if (error) return error
        const degree = qualifier('degree')
        const value = this.printArgument(operands[0]!, 'expression')
        return degree ? `root(${value}, ${this.printArgument(degree, 'expression')})` : `sqrt(${value})`
      }

      case 'log': {
        const error = arity(1, 1)
        if (error) return error
        const base = qualifier('logbase')
        const value = this.printArgument(operands[0]!, 'expression')
        return base ? `log(${value}, ${this.printArgument(base, 'expression')})` : `log(${value})`
      }
    }

    // Functions written with their MathML name, e.g. sin(x), power(a, b), not(c).
    const spec = lookup(FUNCTIONS, op)
    if (!spec || spec.element !== op) return this.unsupported(opNode, `<${op}> is not supported in CellML Text`)

    const error = arity(spec.minArgs, spec.maxArgs)
    if (error) return error
    const slot = spec.argKind === 'boolean' ? 'condition' : 'expression'
    return `${op}(${operands.map((c) => this.printArgument(c, slot)).join(', ')})`
  }

  private parsePiecewise(node: Element): string {
    // format: sel case cond: val; case cond: val; otherwise: val; endsel;
    const pieces: string[] = []
    for (const child of Array.from(node.children)) {
      if (child.localName === 'piece' && child.children.length === 2) {
        // <piece> <value> <condition> </piece>
        const marker = this.attributeMarker(child)
        const val = this.printArgument(child.children[0]!, 'expression')
        const cond = this.printArgument(child.children[1]!, 'condition')
        pieces.push(`${this.standardIndent}${marker}case ${cond}: ${val};`)
      } else if (child.localName === 'otherwise' && child.children.length === 1) {
        const marker = this.attributeMarker(child)
        const val = this.printArgument(child.children[0]!, 'expression')
        pieces.push(`${this.standardIndent}${marker}otherwise: ${val};`)
      } else {
        pieces.push(`${this.standardIndent}${this.unsupported(child, `<${child.localName}> is not supported here in <piecewise>`)}`)
      }
    }

    return `sel\n${this.indent()}${pieces.join(`\n${this.indent()}`)}\n${this.indent()}endsel`
  }
}
