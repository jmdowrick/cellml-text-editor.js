const CELLML_2_0_NS = 'http://www.cellml.org/cellml/2.0#'

export interface CellMLTextGeneratorOptions {
  tabSize?: number | 2
  simplified?: boolean | false
}

export class CellMLTextGenerator {
  private output: string = ''
  private indentLevel: number = 0
  private domParser: DOMParser
  private standardIndent: string = '  '
  private simplified: boolean = false

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
  public generate(xmlString: string): string {
    this.output = ''
    this.indentLevel = 0

    try {
      const doc = this.domParser.parseFromString(xmlString, 'application/xml')
      const errorNode = doc.querySelector('parsererror')
      if (errorNode) throw new Error('XML Parsing Error')

      const model = doc.getElementsByTagNameNS('http://www.cellml.org/cellml/2.0#', 'model')[0]
      if (!model) throw new Error('No CellML 2.0 Model found')

      this.processModel(model)
    } catch (e: any) {
      return `// Error generating text: ${e.message}`
    }

    return this.output
  }

  // --- Recursive Processors ---

  private processModel(model: Element) {
    const name = model.getAttribute('name') || 'unnamed_model'
    if (!this.simplified) {
      this.append(`def model ${name} as`)
      this.indentLevel++
    }

    // 1. Process Units
    const units = model.getElementsByTagName('units')
    for (let i = 0; i < units.length; i++) {
      // Only process units that are direct children of model
      if (units[i]?.parentElement === model) this.processUnits(units[i])
    }

    // 2. Process Components
    const components = Array.from(model.getElementsByTagName('component'))

    for (let i = 0; i < components.length; i++) {
      this.processComponent(components[i])
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
    const name = component?.getAttribute('name') || 'unnamed_component'

    if (!this.simplified) {
      this.append(`def comp ${name} as`)
      this.indentLevel++
    } else {
      this.append(`comp ${name} {`)
      this.indentLevel++
    }

    // Variables.
    const vars = component?.getElementsByTagName('variable') || []
    for (let i = 0; i < vars.length; i++) {
      this.processVariable(vars[i])
    }

    // Math.
    const maths = component?.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math') || []
    for (let i = 0; i < maths.length; i++) {
      this.processMath(maths[i])
    }

    if (!this.simplified) {
      this.indentLevel--
      this.append(`enddef;`)
      this.append('') // Spacer
    } else {
      this.indentLevel--
      this.append(`}`)
      this.append('')
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

    const shouldHideInterface = this.simplified && inf === 'public'
    if (inf && !shouldHideInterface) {
      attributes.push(`interface: ${inf}`)
    }

    if (attributes.length > 0) {
      line += ` {${attributes.join(', ')}}`
    }
    line += ';'
    this.append(line)
  }

  // --- MathML Handling ---

  private processMath(math: Element | null | undefined) {
    const children = Array.from(math?.children || [])

    for (const child of children) {
      // Check if the top-level node is an <apply> with an <eq/> operator
      const isEquation = child.localName === 'apply' && child.firstElementChild?.localName === 'eq'

      if (isEquation) {
        // --- HANDLING STATEMENTS (Assignments) ---
        // This handles "a = b" OR "a + b = c" correctly
        const args = Array.from(child.children).slice(1) // Skip the <eq/> tag

        // Parse Left and Right sides separately
        const lhs = this.parseMathNode(args[0])
        const rhs = this.parseMathNode(args[1])

        // Force the single equals sign here
        this.append(`${lhs} = ${rhs};`)
      } else {
        // --- HANDLING NAKED EXPRESSIONS ---
        // Just in case there is valid MathML that isn't an equation
        const expr = this.parseMathNode(child)
        if (expr) this.append(expr + ';')
      }
    }
  }

  private parseMathNode(node: Element | null | undefined): string {
    if (!node) return ''
    const tag = node.localName

    if (tag === 'apply') {
      return this.parseApply(node)
    } else if (tag === 'ci') {
      // Variable
      return node.textContent?.trim() || ''
    } else if (tag === 'cn') {
      let value = node.textContent?.trim() || '0'
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

          value = `${mantissa}e${exponent}`
        }
      }

      // Extract units attribute across namespace variants
      const units =
        node.getAttributeNS(CELLML_2_0_NS, 'units') ||
        node.getAttribute('cellml:units') ||
        node.getAttribute('units')

      // Suppress {units: dimensionless} ONLY in simple mode
      if (units && !(this.simplified && units === 'dimensionless')) {
        return `${value} {${units}}`
      }
      return value
    } else if (tag === 'piecewise') {
      return this.parsePiecewise(node)
    } else if (tag === 'pi') {
      return 'pi'
    } else if (tag === 'bvar') {
      return '' // Bound variable, handled in context
    }
    console.log(`Unsupported MathML node: ${tag}`)
    return `/* Unsupported MathML node: ${tag} */`
  }

  private parseApply(applyNode: Element): string {
    const children = Array.from(applyNode.children)
    if (children.length === 0) return ''

    const op = children[0]?.localName
    const args = children.slice(1).map((c) => this.parseMathNode(c))

    // Operator Mapping
    switch (op) {
      case 'plus':
        return `(${args.join(' + ')})`
      case 'minus':
        return args.length === 1 ? `-${args[0]}` : `(${args[0]} - ${args[1]})`
      case 'times':
        return `(${args.join(' * ')})`
      case 'divide':
        return `(${args[0]} / ${args[1]})`
      case 'eq':
        return `${args[0]} == ${args[1]}`
      case 'neq':
        return `${args[0]} != ${args[1]}`
      case 'lt':
        return `${args[0]} < ${args[1]}`
      case 'leq':
        return `${args[0]} <= ${args[1]}`
      case 'gt':
        return `${args[0]} > ${args[1]}`
      case 'geq':
        return `${args[0]} >= ${args[1]}`
      case 'and':
        return `${args.join(' and ')}`
      case 'or':
        return `${args.join(' or ')}`
      case 'diff':
        // Logic: <diff/> <bvar><ci>t</ci></bvar> <ci>V</ci> -> ode(V, t)
        const bvar = children.find((c) => c.localName === 'bvar')
        const dependent = children.find((c) => c.localName !== 'diff' && c.localName !== 'bvar')
        const indep = bvar?.children[0]?.textContent || 't' // Assuming <bvar><ci>t</ci></bvar>
        const dep = dependent ? this.parseMathNode(dependent) : 'unknown'
        return `ode(${dep}, ${indep})`

      // Functions
      case 'sin':
      case 'cos':
      case 'tan':
      case 'exp':
      case 'ln':
      case 'log':
        return `${op}(${args[0]})`
      case 'root':
        return `sqrt(${args[0]})`

      default:
        return `${op}(${args.join(', ')})`
    }
  }

  private parsePiecewise(node: Element | null | undefined): string {
    // Basic support for piecewise
    // format: sel case cond: val; case cond: val; otherwise: val; endsel;
    let pieces: string[] = []
    const children = Array.from(node?.children || [])
    children.forEach((child) => {
      if (child.localName === 'piece') {
        // <piece> <value> <condition> </piece>
        const val = this.parseMathNode(child.children[0])
        const cond = this.parseMathNode(child.children[1])
        pieces.push(`${this.standardIndent}case ${cond}: ${val};`)
      } else if (child.localName === 'otherwise') {
        const val = this.parseMathNode(child.children[0])
        pieces.push(`${this.standardIndent}otherwise: ${val};`)
      }
    })

    return `sel\n${this.indent()}${pieces.join(`\n${this.indent()}`)}\n${this.indent()}endsel`
  }
}
