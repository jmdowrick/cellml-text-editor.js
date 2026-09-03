import { CellMLTextScanner, TokenType } from './CellMLTextScanner'
import { analyzeComponentVariables } from './CellMLVariableResolution'

const CELLML_NS = 'http://www.cellml.org/cellml/2.0#'
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

export interface ParserOptions {
  sourceLineAttribute?: string | null
  simplified?: boolean | false
  managed?: boolean | false
  getExternalVariable?: (componentName: string, variableName: string) => ExternalVarMetadata | undefined
}

export interface ExternalVarMetadata {
  units?: string
  initialValue?: string
  interface?: string
}

export interface ParserError {
  line: number
  message: string
}

export interface ParserResult {
  xml: string | null
  errors: ParserError[]
}

export class CellMLTextParser {
  private scanner!: CellMLTextScanner
  private doc!: XMLDocument
  private sourceLineAttr: string | null
  private simplified: boolean
  private managed: boolean
  private getExternalVariable?: (compName: string, varName: string) => ExternalVarMetadata | undefined

  constructor(options: ParserOptions = {}) {
    this.sourceLineAttr =
      options.sourceLineAttribute === undefined ? 'data-source-location' : options.sourceLineAttribute
    this.simplified = options.simplified ?? false
    this.managed = options.managed ?? false
    this.getExternalVariable = options.getExternalVariable
  }

  public parse(text: string): ParserResult {
    this.scanner = new CellMLTextScanner(text)
    this.doc = document.implementation.createDocument(CELLML_NS, 'model', null)

    try {
      const root = this.doc.documentElement

      if (this.simplified && this.scanner.token !== TokenType.KwDef) {
        root.setAttribute('name', 'implicit_model')

        let defaultComp: Element | null = null
        const getDefaultComp = () => {
          if (!defaultComp) {
            defaultComp = this.doc.createElementNS(CELLML_NS, 'component')
            defaultComp.setAttribute('name', 'implicit_component')
            root.appendChild(defaultComp)
          }
          return defaultComp
        }

        while (this.scanner.token !== TokenType.EOF) {
          if (this.scanner.token === TokenType.KwComp) {
            this.parseSimpleComponentBlock(root)
          } else if (this.scanner.token === TokenType.KwVar) {
            this.parseVariable(getDefaultComp())
          } else if (this.scanner.token === TokenType.Identifier || this.scanner.token === TokenType.KwSel) {
            this.parseMathEquation(getDefaultComp())
          } else {
            this.scanner.nextToken()
          }
        }
      } else {
        // Standard Advanced Mode parsing
        this.expect(TokenType.KwDef)
        this.expect(TokenType.KwModel)

        if (this.scanner.token === TokenType.Identifier) {
          root.setAttribute('name', this.scanner.value)
          this.scanner.nextToken()
        }

        this.expect(TokenType.KwAs)

        while (this.scanner.token !== TokenType.KwEndDef && this.scanner.token !== TokenType.EOF) {
          if (this.scanner.token === TokenType.KwDef) {
            this.parseBlock(root)
          } else {
            this.scanner.nextToken()
          }
        }

        this.expect(TokenType.KwEndDef)
        this.expect(TokenType.SemiColon)
      }

      // If running in managed mode, retrieve external variables and inject them into XML
      if (this.managed) {
        this.injectManagedVariables(root)
      }

      return { xml: '<?xml version="1.0" encoding="UTF-8"?>\n' + this.serialize(root), errors: [] }
    } catch (e: any) {
      return { xml: null, errors: [{ line: this.scanner.getLine(), message: e.message || 'Unknown parsing error' }] }
    }
  }

  /**
   * Scans parsed components and queries external management for referenced variables
   */
  private injectManagedVariables(root: Element) {
  const components = Array.from(root.getElementsByTagName('component'))

  components.forEach((comp) => {
    const compName = comp.getAttribute('name') || 'implicit_component'
    const analysis = analyzeComponentVariables(comp)

    // Variables present in math + any explicitly declared
    const requiredVars = new Set<string>([...analysis.variables, ...analysis.declared])

    const existingVarEls = Array.from(comp.getElementsByTagName('variable'))
    const existingVarMap = new Map(existingVarEls.map((v) => [v.getAttribute('name'), v]))

    const mathEl = comp.getElementsByTagNameNS(MATHML_NS, 'math')[0]

    requiredVars.forEach((vName) => {
      const extMeta = this.getExternalVariable ? this.getExternalVariable(compName, vName) : undefined
      let varEl = existingVarMap.get(vName)

      if (!varEl) {
        varEl = this.doc.createElementNS(CELLML_NS, 'variable')
        varEl.setAttribute('name', vName)
        if (mathEl) {
          comp.insertBefore(varEl, mathEl)
        } else {
          comp.appendChild(varEl)
        }
      }

      varEl.setAttribute('units', extMeta?.units || 'dimensionless')
      
      if (extMeta?.initialValue) {
        varEl.setAttribute('initial_value', extMeta.initialValue)
      } else {
        varEl.removeAttribute('initial_value')
      }

      if (extMeta?.interface) {
        varEl.setAttribute('interface', extMeta.interface)
      }
    })
  })
}


  private parseSimpleComponentBlock(parent: Element) {
    this.expect(TokenType.KwComp)
    const name = this.expectValue(TokenType.Identifier)

    this.expect(TokenType.LBrace) // Expect {

    const comp = this.doc.createElementNS(CELLML_NS, 'component')
    comp.setAttribute('name', name)
    parent.appendChild(comp)

    while (this.scanner.token !== TokenType.RBrace && this.scanner.token !== TokenType.EOF) {
      if (this.scanner.token === TokenType.KwVar) {
        this.parseVariable(comp)
      } else if (this.scanner.token === TokenType.Identifier || this.scanner.token === TokenType.KwSel) {
        this.parseMathEquation(comp)
      } else {
        this.scanner.nextToken()
      }
    }

    this.expect(TokenType.RBrace) // Consume }
  }

  private parseBlock(parent: Element) {
    this.expect(TokenType.KwDef) // Consume 'def'

    if (this.scanner.token === TokenType.KwComp) {
      this.parseComponent(parent)
    } else if (this.scanner.token === TokenType.KwUnit) {
      this.parseUnit(parent)
    } else {
      throw new Error("Expected 'comp' or 'unit' after 'def'")
    }
  }

  private parseComponent(parent: Element) {
    this.expect(TokenType.KwComp)
    const name = this.expectValue(TokenType.Identifier)
    this.expect(TokenType.KwAs)

    const comp = this.doc.createElementNS(CELLML_NS, 'component')
    comp.setAttribute('name', name)
    parent.appendChild(comp)

    while (this.scanner.token !== TokenType.KwEndDef && this.scanner.token !== TokenType.EOF) {
      if (this.scanner.token === TokenType.KwVar) {
        this.parseVariable(comp)
      } else if (this.scanner.token === TokenType.Identifier || this.scanner.token === TokenType.KwSel) {
        this.parseMathEquation(comp)
      } else {
        this.scanner.nextToken()
      }
    }

    this.expect(TokenType.KwEndDef)
    this.expect(TokenType.SemiColon)
  }

  private parseVariable(parent: Element) {
    this.expect(TokenType.KwVar)
    const name = this.expectValue(TokenType.Identifier)
    this.expect(TokenType.Colon)
    const units = this.expectValue(TokenType.Identifier)

    const variable = this.doc.createElementNS(CELLML_NS, 'variable')
    variable.setAttribute('name', name)
    variable.setAttribute('units', units)

    let hasInterface = false

    if ((this.scanner.token as TokenType) === TokenType.LBrace) {
      this.scanner.nextToken()
      while ((this.scanner.token as TokenType) !== TokenType.RBrace && this.scanner.token !== TokenType.EOF) {
        const prop = this.expectValue(TokenType.Identifier)
        this.expect(TokenType.Colon)

        let val = ''
        if ((this.scanner.token as TokenType) === TokenType.OpMinus) {
          this.scanner.nextToken()
          val = '-' + this.expectValue(TokenType.Number)
        } else if ((this.scanner.token as TokenType) === TokenType.Number) {
          val = this.expectValue(TokenType.Number)
        } else {
          val = this.expectValue(TokenType.Identifier)
        }

        if (prop === 'init') variable.setAttribute('initial_value', val)
        else if (prop === 'interface') {
          variable.setAttribute('interface', val)
          hasInterface = true
        }

        if ((this.scanner.token as TokenType) === TokenType.OpComma) this.scanner.nextToken()
      }
      this.expect(TokenType.RBrace)
    }

    // Explicitly tag interface="public" in XML DOM when unspecified in text
    if (!hasInterface) {
      variable.setAttribute('interface', 'public')
    }

    this.expect(TokenType.SemiColon)
    parent.appendChild(variable)
  }

  private parseUnit(parent: Element) {
    this.expect(TokenType.KwUnit)
    while (this.scanner.token !== TokenType.KwEndDef && this.scanner.token !== TokenType.EOF) {
      this.scanner.nextToken()
    }
    this.expect(TokenType.KwEndDef)
    this.expect(TokenType.SemiColon)
  }

  // --- Math Parsing ---

  private parseMathEquation(parent: Element) {
    const startLine = this.scanner.getLine()
    let math = parent.getElementsByTagNameNS(MATHML_NS, 'math')[0]
    if (!math) {
      math = this.doc.createElementNS(MATHML_NS, 'math')
      parent.appendChild(math)
    }

    const apply = this.doc.createElementNS(MATHML_NS, 'apply')
    const eq = this.doc.createElementNS(MATHML_NS, 'eq')
    apply.appendChild(eq)

    const lhsNode = this.parseExpression()
    this.expect(TokenType.OpAss)
    const rhsNode = this.parseExpression()
    const endLine = this.scanner.getLine()

    if (this.sourceLineAttr) {
      apply.setAttribute(
        this.sourceLineAttr,
        `${startLine.toString()}` + (endLine !== startLine ? `-${endLine.toString()}` : '')
      )
    }

    apply.appendChild(lhsNode)
    apply.appendChild(rhsNode)
    math.appendChild(apply)

    this.expect(TokenType.SemiColon)
  }

  // Recursive Descent for Math: Condition -> Comparison -> Expression -> Term -> Factor
  private parseCondition(): Element {
    // 1. Get the first comparison (e.g., "x > 5")
    let left = this.parseComparison()

    // 2. Loop while we see Logical Operators
    while (this.scanner.token === TokenType.OpAnd || this.scanner.token === TokenType.OpOr) {
      const op = this.scanner.token
      this.scanner.nextToken()

      // 3. Get the next condition (e.g., "y < 10")
      const right = this.parseComparison()

      // 4. Wrap them in an <apply> block
      const apply = this.doc.createElementNS(MATHML_NS, 'apply')

      // MathML uses <and/> and <or/> tags
      const opNode = this.doc.createElementNS(MATHML_NS, op === TokenType.OpAnd ? 'and' : 'or')

      apply.appendChild(opNode)
      apply.appendChild(left)
      apply.appendChild(right)

      // 5. The result becomes the new 'left' for the next iteration
      // This supports chaining: a and b and c
      left = apply
    }

    return left
  }

  private isComparisonToken(t: TokenType): boolean {
    return [TokenType.OpEq, TokenType.OpNe, TokenType.OpLt, TokenType.OpLe, TokenType.OpGt, TokenType.OpGe].includes(t)
  }

  // The new parsing layer
  private parseComparison(): Element {
    // 1. Parse the left side (standard arithmetic expression)
    let left = this.parseExpression()

    // 2. Check if the next token is a comparison operator (==, <, >, etc.)
    if (this.isComparisonToken(this.scanner.token)) {
      const opToken = this.scanner.token
      this.scanner.nextToken() // Consume the operator

      // 3. Parse the right side
      const right = this.parseExpression()

      // 4. Create the <apply> block
      const apply = this.doc.createElementNS(MATHML_NS, 'apply')

      // Map token to MathML tag
      let tagName = ''
      switch (opToken) {
        case TokenType.OpEq:
          tagName = 'eq'
          break
        case TokenType.OpNe:
          tagName = 'neq'
          break
        case TokenType.OpLt:
          tagName = 'lt'
          break
        case TokenType.OpLe:
          tagName = 'leq'
          break
        case TokenType.OpGt:
          tagName = 'gt'
          break
        case TokenType.OpGe:
          tagName = 'geq'
          break
        case TokenType.OpAnd:
          tagName = 'and'
          break
      }

      const opNode = this.doc.createElementNS(MATHML_NS, tagName)
      apply.appendChild(opNode)
      apply.appendChild(left)
      apply.appendChild(right)

      return apply
    }

    // If no comparison found, just return the expression (e.g. boolean variable)
    return left
  }

  /**
   * Checks if an element is an <apply> block for a specific operator.
   * e.g. isMathMLApply(node, 'plus') returns true for <apply><plus/>...</apply>
   */
  private isMathMLApply(node: Element, operatorName: string): boolean {
    // 1. Must be an <apply> tag
    if (node.localName !== 'apply') return false

    // 2. The first child must be the operator tag (e.g. <plus/>)
    const op = node.firstElementChild
    return op ? op.localName === operatorName : false
  }

  private parseExpression(): Element {
    let left = this.parseTerm()

    while (this.scanner.token === TokenType.OpPlus || this.scanner.token === TokenType.OpMinus) {
      const op = this.scanner.token
      this.scanner.nextToken()
      const right = this.parseTerm()

      if (op === TokenType.OpPlus && this.isMathMLApply(left, 'plus')) {
        left.appendChild(right)
      } else {
        const apply = this.doc.createElementNS(MATHML_NS, 'apply')
        const opNode = this.doc.createElementNS(MATHML_NS, op === TokenType.OpPlus ? 'plus' : 'minus')
        apply.appendChild(opNode)
        apply.appendChild(left)
        apply.appendChild(right)
        left = apply
      }
    }
    return left
  }

  private parseTerm(): Element {
    let left = this.parseFactor()

    while (this.scanner.token === TokenType.OpTimes || this.scanner.token === TokenType.OpDivide) {
      const op = this.scanner.token
      this.scanner.nextToken()
      const right = this.parseFactor()
      if (op === TokenType.OpTimes && this.isMathMLApply(left, 'times')) {
        left.appendChild(right)
      } else {
        const apply = this.doc.createElementNS(MATHML_NS, 'apply')
        const opNode = this.doc.createElementNS(MATHML_NS, op === TokenType.OpTimes ? 'times' : 'divide')
        apply.appendChild(opNode)
        apply.appendChild(left)
        apply.appendChild(right)
        left = apply
      }
    }
    return left
  }

  /**
   * Checks if the identifier is a reserved MathML constant name
   * and returns the corresponding element, or null if it's a variable.
   */
  private createMathMLConstant(name: string): Element | null {
    // Map of "User Text" -> "MathML Tag Name"
    const constants: Record<string, string> = {
      pi: 'pi',
      e: 'exponentiale',
      inf: 'infinity',
      infinity: 'infinity',
      NaN: 'notanumber',
      true: 'true',
      false: 'false',
    }

    if (constants.hasOwnProperty(name)) {
      return this.doc.createElementNS(MATHML_NS, constants[name] || '')
    }

    return null
  }

  private parseFactor(): Element {
    // Handle unary minus.
    if (this.scanner.token === TokenType.OpMinus) {

      // Recursively call parseFactor.
      // This handles cases like "-5", "-a", or even "- -5"
      this.scanner.nextToken()
      const child = this.parseFactor()

      // Create the <apply><minus/><child/></apply> structure
      const apply = this.doc.createElementNS(MATHML_NS, 'apply')
      const minus = this.doc.createElementNS(MATHML_NS, 'minus')

      apply.appendChild(minus)
      apply.appendChild(child)

      return apply
    }

    if (this.scanner.token === TokenType.Number) {
      const val = this.scanner.value
      this.scanner.nextToken()
      const cn = this.doc.createElementNS(MATHML_NS, 'cn')
      let hasExplicitUnits = false

      // Check for a units annotation attached to number, e.g. {dimensionless}
      if ((this.scanner.token as TokenType) === TokenType.LBrace) {
        this.scanner.nextToken() // eat '{'
        const unitsName = this.expectValue(TokenType.Identifier)
        cn.setAttributeNS(CELLML_NS, 'cellml:units', unitsName)
        hasExplicitUnits = true
        this.expect(TokenType.RBrace)
      }

      // Explicitly tag cellml:units="dimensionless" in XML DOM when omitted in text
      if (!hasExplicitUnits) {
        cn.setAttributeNS(CELLML_NS, 'cellml:units', 'dimensionless')
      }

      if (val.match(/^-?[\d.]+[eE][+-]?\d+$/)) {
        cn.setAttribute('type', 'e-notation')
        const sep = this.doc.createElementNS(MATHML_NS, 'sep')
        const [mantissa, exponent] = val.split(/[eE]/)
        cn.appendChild(this.doc.createTextNode(mantissa || '1'))
        cn.appendChild(sep)
        cn.appendChild(this.doc.createTextNode(exponent || '0'))
      } else {
        cn.textContent = val
      }
      return cn
    } else if (this.scanner.token === TokenType.Identifier) {
      const name = this.scanner.value
      this.scanner.nextToken()

      // Check if function call: ode(a, b) or sin(x).
      if ((this.scanner.token as TokenType) === TokenType.LParam) {
        return this.parseFunctionCall(name)
      }

      // Check if it is a known MathML constant (pi, e, inf, etc.)
      const constantNode = this.createMathMLConstant(name)
      if (constantNode) {
        return constantNode
      }

      const ci = this.doc.createElementNS(MATHML_NS, 'ci')
      ci.textContent = name
      return ci
    } else if (this.scanner.token === TokenType.LParam) {
      this.scanner.nextToken()
      const node = this.parseExpression()
      this.expect(TokenType.RParam)
      return node
    } else if (this.scanner.token === TokenType.KwSel) {
      return this.parsePiecewise()
    }

    throw new Error(`Unexpected token in math: ${this.scanner.value}`)
  }

  private parsePiecewise(): Element {
    const piecewise = this.doc.createElementNS(MATHML_NS, 'piecewise')

    this.expect(TokenType.KwSel)

    // Handle 'case' blocks
    while (this.scanner.token === TokenType.KwCase) {
      this.expect(TokenType.KwCase)

      // Parse condition (e.g., x > y, z < 10 and a == b)
      const condition = this.parseCondition()

      this.expect(TokenType.Colon)

      // Parse value (e.g., 10.0)
      const value = this.parseExpression()

      this.expect(TokenType.SemiColon)

      const piece = this.doc.createElementNS(MATHML_NS, 'piece')
      // MathML order is <piece> value condition </piece>
      piece.appendChild(value)
      piece.appendChild(condition)
      piecewise.appendChild(piece)
    }

    // Handle optional 'otherwise' block
    if (this.scanner.token === TokenType.KwOtherwise) {
      this.expect(TokenType.KwOtherwise)
      this.expect(TokenType.Colon)
      const value = this.parseExpression()
      this.expect(TokenType.SemiColon)

      const otherwise = this.doc.createElementNS(MATHML_NS, 'otherwise')
      otherwise.appendChild(value)
      piecewise.appendChild(otherwise)
    }

    this.expect(TokenType.KwEndSel)
    return piecewise
  }

  private parseFunctionCall(funcName: string): Element {
    this.expect(TokenType.LParam)

    // Special Case: ode(dep, indep) -> <diff/> <bvar>indep</bvar> dep
    if (funcName === 'ode') {
      const dep = this.parseExpression()
      this.expect(TokenType.OpComma)
      const indep = this.parseExpression()
      this.expect(TokenType.RParam)

      const diffApply = this.doc.createElementNS(MATHML_NS, 'apply')
      diffApply.appendChild(this.doc.createElementNS(MATHML_NS, 'diff'))

      const bvar = this.doc.createElementNS(MATHML_NS, 'bvar')
      bvar.appendChild(indep)
      diffApply.appendChild(bvar)

      diffApply.appendChild(dep)
      return diffApply
    }

    const apply = this.doc.createElementNS(MATHML_NS, 'apply')
    const op = this.doc.createElementNS(MATHML_NS, funcName)
    apply.appendChild(op)

    if (this.scanner.token !== TokenType.RParam) {
      do {
        if (this.scanner.token === TokenType.OpComma) this.scanner.nextToken()
        apply.appendChild(this.parseExpression())
      } while (this.scanner.token === TokenType.OpComma)
    }

    this.expect(TokenType.RParam)
    return apply
  }

  // --- Helpers ---
  private expect(type: TokenType) {
    if (this.scanner.token !== type) {
      throw new Error(`Syntax Error: Expected ${TokenType[type]} but found '${this.scanner.value}'`)
    }
    this.scanner.nextToken()
  }

  private expectValue(type: TokenType): string {
    if (this.scanner.token !== type) {
      throw new Error(`Expected value of type ${TokenType[type]}, got ${this.scanner.token}`)
    }
    const val = this.scanner.value
    this.scanner.nextToken()
    return val
  }

  /**
   * Checks if the element or any of its descendants use a CellML attribute
   * (e.g. cellml:units).
   */
  private usesCellMLNamespace(root: Element): boolean {
    // 1. Check the descendants
    const descendants = root.getElementsByTagName('*')
    for (let i = 0; i < descendants.length; i++) {
      const el = descendants[i]
      for (let j = 0; el && j < el.attributes.length; j++) {
        const attr = el.attributes[j]
        // Check by Namespace URI.
        if (attr && attr.namespaceURI === CELLML_NS) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Checks if a specific Namespace URI is declared on this node
   * and returns the prefix used (e.g. 'cellml', 'cellml2', or '' for default).
   * Returns null if not found.
   */
  private getPrefixForNamespace(node: Element, namespaceUri: string): string | null {
    const XMLNS_URI = 'http://www.w3.org/2000/xmlns/'

    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes[i]
      if (!attr) continue

      // Check if this attribute is a namespace declaration
      if (attr.namespaceURI === XMLNS_URI) {
        // Check if it points to the target Namespace URI
        if (attr.value === namespaceUri) {
          // attr.localName is the prefix (e.g. 'cellml' in xmlns:cellml)
          // If localName is 'xmlns', it means it's the default namespace (prefix is empty)
          return attr.localName === 'xmlns' ? '' : attr.localName
        }
      }
    }

    return null
  }

  private serialize(node: Element, level: number = 0): string {
    const indent = '  '.repeat(level)
    const tagName = node.tagName
    const localName = node.localName

    // Explicitly add xmlns if this is a CellML model or MathML block
    // and the attribute wasn't manually set already.
    let props = ''
    if (localName === 'model' && !node.hasAttribute('xmlns')) {
      props += ` xmlns="${CELLML_NS}"`
    }

    if (localName === 'math' && !node.hasAttribute('xmlns')) {
      props += ` xmlns="${MATHML_NS}"`
      if (this.usesCellMLNamespace(node) && !node.hasAttribute('xmlns:cellml')) {
        const existingPrefix = this.getPrefixForNamespace(node, CELLML_NS)
        if (existingPrefix === null) {
          props += ` xmlns:cellml="${CELLML_NS}"`
        }
      }
    }

    // Build Attributes String.
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes[i]
      if (attr) {
        if (this.sourceLineAttr && attr.name === this.sourceLineAttr) {
          continue
        }
        props += ` ${attr.name}="${attr.value}"`
      }
    }

    // Determine if we have children.
    const children = Array.from(node.childNodes)
    const hasElementChildren = children.some((c) => c.nodeType === 1)
    const textContent = node.textContent?.trim()

    // Self-closing tag (e.g. <diff/>).
    if (children.length === 0 && !textContent) {
      return `${indent}<${tagName}${props}/>`
    }

    // Node with text only (e.g. <cn>10</cn> or <ci>x</ci>).
    // We print this on a single line to preserve MathML readability.
    if (!hasElementChildren) {
      return `${indent}<${tagName}${props}>${textContent}</${tagName}>`
    } else if (node.tagName === 'cn' && children.length === 3) {
      return `${indent}<${tagName}${props}>${children[0]?.textContent}<sep/>${children[2]?.textContent}</${tagName}>`
    }

    // Node with nested elements (e.g. <apply>, <component>).
    let output = `${indent}<${tagName}${props}>\n`

    children.forEach((child) => {
      if (child.nodeType === 1) {
        // Recursively serialize elements.
        output += this.serialize(child as Element, level + 1) + '\n'
      }
    })

    output += `${indent}</${tagName}>`
    return output
  }
}
