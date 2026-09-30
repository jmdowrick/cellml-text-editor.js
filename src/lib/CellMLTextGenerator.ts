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
  mathFingerprint,
  variableFingerprint,
} from './CellMLMathML'
import {
  commentsIn,
  isTrailing,
  isTriviaLine,
  type ComponentLayout,
  type LayoutItem,
  type ModelLayout,
  type StatementLayout,
  type TextLayout,
  type TriviaLines,
} from './CellMLTextLayout'
import { CellMLTextParser } from './CellMLTextParser'

/** Children of an <apply> that qualify the operator rather than being operands. */
const QUALIFIERS = new Set(['bvar', 'degree', 'logbase'])

export interface CellMLTextGeneratorOptions {
  tabSize?: number
  simplified?: boolean
}

export interface GenerateOptions {
  /**
   * The layout saved with the model (see CellMLTextLayout). Comments, blank lines
   * and each statement as it was typed come back wherever the math still matches.
   */
  layout?: TextLayout | null
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
  /** The layout would have changed the math, so it was ignored. Never expected; reported so it can be. */
  layoutRejected?: true
}

/** One statement of a component, as the XML has it. Its text is at indent level 0. */
interface XmlStatement {
  kind: 'var' | 'eq' | 'marker'
  text: string
  /** eq: the equation's fingerprint; var: the variable's. */
  fp: string | null
  /** eq: the fingerprint of the left-hand side. */
  lhs: string | null
  /** var: its name. */
  name: string | null
  /** Written without errors, so the XML holds nothing more than the text says. */
  clean: boolean
}

/** What a layout statement's text says, found by parsing it on its own. Null when it isn't exactly one statement. */
interface CheckedStatement {
  fp: string
  lhs: string | null
  name: string | null
}

/** Lines of output, at indent level 0 of their block. */
interface Chunk {
  kind: 'var' | 'eq' | 'trivia'
  lines: string[]
}

export class CellMLTextGenerator {
  private output: string = ''
  private errors: GeneratorError[] = []
  private indentLevel: number = 0
  private domParser: DOMParser
  private standardIndent: string = '  '
  private layout: TextLayout | null = null
  private checkCache = new Map<string, CheckedStatement | null>()
  private checker: CellMLTextParser | null = null
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

  /** Writes lines written at level 0 at the current indent. */
  private appendLines(lines: string[]) {
    const indent = this.indent()
    for (const line of lines) this.output += (line === '' ? '' : indent + line) + '\n'
  }

  // --- Main Entry Point ---

  /** The text for a CellML 2.0 model. Use generateResult() to also learn what couldn't be written. */
  public generate(xmlString: string, options: GenerateOptions = {}): string {
    return this.generateResult(xmlString, options).text
  }

  /**
   * The text for a CellML 2.0 model, and everything in its math that the text
   * can't hold. When `errors` is not empty, editing and re-parsing the text would
   * lose or change those parts, so the text marks each one (`#unsupported:…#`)
   * and won't parse until they are removed.
   *
   * With a `layout`, the text is written the way it was typed. That never changes
   * the math: parsing the text gives the same CellML as it would without the layout.
   */
  public generateResult(xmlString: string, options: GenerateOptions = {}): GeneratorResult {
    const plain = this.run(xmlString, null)
    if (!options.layout || plain.failed) return plain.result

    const laidOut = this.run(xmlString, options.layout)
    // Every statement was checked on its own; this checks the whole text too, when it parses.
    if (plain.result.errors.length === 0 && !this.sameMeaning(plain.result.text, laidOut.result.text)) {
      return { ...plain.result, layoutRejected: true }
    }
    return { text: laidOut.result.text, errors: plain.result.errors }
  }

  private run(xmlString: string, layout: TextLayout | null): { result: GeneratorResult; failed: boolean } {
    this.output = ''
    this.errors = []
    this.indentLevel = 0
    this.layout = layout
    this.usedComponentLayouts = new Set()

    try {
      const doc = this.domParser.parseFromString(xmlString, 'application/xml')
      const errorNode = doc.querySelector('parsererror')
      if (errorNode) throw new Error('XML Parsing Error')

      const model = doc.getElementsByTagNameNS(CELLML_2_0_NS, 'model')[0]
      if (!model) throw new Error('No CellML 2.0 Model found')

      this.processModel(model)
    } catch (e: any) {
      const message = `Error generating text: ${e.message}`
      return { result: { text: `// ${message}`, errors: [{ message }] }, failed: true }
    } finally {
      this.layout = null
    }

    return { result: { text: this.output, errors: this.errors }, failed: false }
  }

  // --- Recursive Processors ---

  private processModel(model: Element) {
    // The editor works on one component at a time, so Simple Mode shows just the first.
    const components = Array.from(model.getElementsByTagName('component'))
    const units = Array.from(model.getElementsByTagName('units')).filter((u) => u.parentElement === model)

    if (this.simplified) {
      const component = components[0]
      if (component) this.processComponent(component, this.componentLayout(component, true))
      // Blank lines that separated the var lines from the equations have nothing to separate here.
      this.output = this.output.replace(/^\n+/, '').trimEnd() + '\n'
      return
    }

    const name = model.getAttribute('name') || 'unnamed_model'
    if (this.layout?.model) {
      this.processLaidOutModel(name, model, units, components, this.layout.model)
      return
    }

    this.append(`def model ${name} as`)
    this.indentLevel++

    // 1. Process Units (not representable in Simple Mode)
    for (const unit of units) {
      this.appendLines(this.unitsText(unit).split('\n'))
      this.append('') // Spacer
    }

    // 2. Process Components.
    for (const component of components) {
      this.processComponent(component, this.componentLayout(component, false))
      this.output += '\n' // Spacer
    }

    // Ensure single newline after last component.
    this.output = this.output.trimEnd() + '\n'

    this.indentLevel--
    this.append(`enddef;`)
  }

  /** Advanced Mode, following the layout: its blocks in its order, then anything new. */
  private processLaidOutModel(name: string, model: Element, units: Element[], components: Element[], layout: ModelLayout) {
    this.appendLines(triviaOf(layout.leading))
    this.append(`def model ${name} as${trailingOf(layout.trailing)}`)
    this.indentLevel++

    const unusedUnits = [...units]
    const unusedComponents = [...components]
    const take = (list: Element[], blockName: string) => {
      const at = list.findIndex((el) => el.getAttribute('name') === blockName)
      return at < 0 ? undefined : list.splice(at, 1)[0]
    }
    let written = 0
    const spacer = () => {
      if (written++ > 0) this.append('')
    }

    // Units that only the XML has come first, as they would without a layout.
    const laidOutUnits = new Set(layout.blocks.filter((b) => b.kind === 'units').map((b) => b.name))
    for (const unit of units.filter((u) => !laidOutUnits.has(u.getAttribute('name') ?? ''))) {
      spacer()
      this.appendLines(this.unitsText(unit).split('\n'))
      unusedUnits.splice(unusedUnits.indexOf(unit), 1)
    }

    for (const block of layout.blocks) {
      if (block.kind === 'units') {
        // Units come from the XML; the layout only has the comments around them.
        const unit = take(unusedUnits, block.name)
        written++
        if (unit) {
          this.appendLines(triviaOf(block.leading))
          this.appendLines(withTrailing(this.unitsText(unit).split('\n'), block.trailing))
        } else {
          this.appendLines(orphanComments(block))
        }
      } else {
        const component = take(unusedComponents, block.name)
        const componentLayout = this.takeComponentLayout(block.name)
        written++
        if (component) {
          this.processComponent(component, componentLayout)
        } else if (componentLayout) {
          // The component has gone; its comments stay where it was.
          const end = [componentLayout.trailing, componentLayout.endTrailing].map((t) => trailingOf(t).trim()).filter(Boolean)
          this.appendLines(triviaOf(componentLayout.leading))
          this.appendLines(componentLayout.statements.flatMap(orphanComments))
          this.appendLines([...triviaOf(componentLayout.footer), ...end])
        }
      }
    }

    for (const component of unusedComponents) {
      spacer()
      this.processComponent(component, this.componentLayout(component, false))
    }

    this.appendLines(triviaOf(layout.footer))
    this.indentLevel--
    this.append(`enddef;${trailingOf(layout.endTrailing)}`)
    this.appendLines(triviaOf(layout.after))
  }

  private unitsText(unit: Element): string {
    const name = unit.getAttribute('name') || 'unnamed_units'
    const lines = [`def unit ${name} as`]

    for (const u of Array.from(unit.getElementsByTagName('unit'))) {
      const prefix = u.getAttribute('prefix')
      const unitsRef = u.getAttribute('units')
      const exponent = u.getAttribute('exponent')
      const multiplier = u.getAttribute('multiplier')

      let line = `unit ${unitsRef}`
      if (prefix) line += ` {prefix: ${prefix}}`
      if (exponent) line += ` {exponent: ${exponent}}`
      if (multiplier) line += ` {multiplier: ${multiplier}}`
      line += ';'

      lines.push(this.standardIndent + line)
    }

    lines.push('enddef;')
    return lines.join('\n')
  }

  /** The layout of a component, for the canonical model: the first unused one with its name (Simple Mode: or the first). */
  private componentLayout(component: Element, simple: boolean): ComponentLayout | undefined {
    const name = component.getAttribute('name') ?? ''
    return this.takeComponentLayout(name) ?? (simple ? this.layout?.components[0] : undefined)
  }

  private usedComponentLayouts = new Set<ComponentLayout>()

  private takeComponentLayout(name: string): ComponentLayout | undefined {
    if (!this.layout) return undefined
    const found = this.layout.components.find((c) => c.name === name && !this.usedComponentLayouts.has(c))
    if (found) this.usedComponentLayouts.add(found)
    return found
  }

  /** One component. In Advanced Mode its `def comp … enddef;` lines surround the statements. */
  private processComponent(component: Element, layout: ComponentLayout | undefined) {
    const statements = this.statementsOf(component)
    const chunks = layout ? this.laidOutStatements(statements, layout) : this.canonicalStatements(statements)

    if (this.simplified) {
      for (const chunk of chunks) this.appendLines(chunk.lines)
      if (layout) this.appendLines(triviaOf(layout.footer))
      return
    }

    const name = component.getAttribute('name') || 'unnamed_component'
    if (layout) this.appendLines(triviaOf(layout.leading))
    this.append(`def comp ${name} as${trailingOf(layout?.trailing)}`)
    this.indentLevel++
    for (const chunk of chunks) this.appendLines(chunk.lines)
    if (layout) this.appendLines(triviaOf(layout.footer))
    this.indentLevel--
    this.append(`enddef;${trailingOf(layout?.endTrailing)}`)
  }

  /** Without a layout: every var, then every equation, as the XML has them. */
  private canonicalStatements(statements: XmlStatement[]): Chunk[] {
    return statements
      .filter((s) => !this.simplified || s.kind !== 'var')
      .sort((a, b) => Number(a.kind !== 'var') - Number(b.kind !== 'var'))
      .map((s) => ({ kind: s.kind === 'var' ? 'var' : 'eq', lines: s.text.split('\n') }))
  }

  /** The component's statements, generated at indent level 0: its variables, then its math. */
  private statementsOf(component: Element): XmlStatement[] {
    const saved = this.indentLevel
    this.indentLevel = 0
    const statements: XmlStatement[] = []

    const clean = (make: () => string) => {
      const before = this.errors.length
      const text = make()
      return { text, clean: this.errors.length === before }
    }

    if (!this.simplified) {
      for (const v of Array.from(component.getElementsByTagName('variable'))) {
        statements.push({ kind: 'var', text: this.variableText(v), fp: variableFingerprint(v), lhs: null, name: v.getAttribute('name'), clean: true })
      }
    }

    for (const math of Array.from(component.getElementsByTagNameNS(MATHML_NS, 'math'))) {
      const mathMarker = this.attributeMarker(math)
      if (mathMarker) statements.push({ kind: 'marker', text: `${mathMarker};`, fp: null, lhs: null, name: null, clean: false })

      for (const child of Array.from(math.children)) {
        const operands = this.operandsOf(child)
        if (child.localName === 'apply' && child.firstElementChild?.localName === 'eq' && operands.length === 2) {
          const [lhs, rhs] = operands
          const { text, clean: ok } = clean(() => {
            const marker = this.attributeMarker(child) + this.attributeMarker(child.firstElementChild!)
            return `${marker}${this.printArgument(lhs!, 'expression')} = ${this.printArgument(rhs!, 'expression')};`
          })
          statements.push({ kind: 'eq', text, fp: mathFingerprint(child), lhs: mathFingerprint(lhs!), name: null, clean: ok })
        } else {
          // Only equations can be written as a statement.
          const text = `${this.unsupported(child, 'The top level of <math> can only hold equations (<apply><eq/>…</apply>)')};`
          statements.push({ kind: 'marker', text, fp: null, lhs: null, name: null, clean: false })
        }
      }
    }

    this.indentLevel = saved
    return statements
  }

  private variableText(v: Element): string {
    const name = v.getAttribute('name')
    const units = v.getAttribute('units')
    const initial = v.getAttribute('initial_value')
    const inf = v.getAttribute('interface') || 'public'
    let line = `var ${name}: ${units}`
    let attributes = []

    if (initial) attributes.push(`init: ${initial}`)

    if (inf) attributes.push(`interface: ${inf}`)

    if (attributes.length > 0) {
      line += ` {${attributes.join(', ')}}`
    }
    line += ';'
    return line
  }

  // --- Layout ---

  /**
   * The statements in the layout's order, each written as it was typed when its
   * math still matches. Equations keep the XML's order: layout equations are
   * paired with XML ones by fingerprint, then by left-hand side, then by position.
   * Variables keep the layout's order, paired by name.
   */
  private laidOutStatements(statements: XmlStatement[], layout: ComponentLayout): Chunk[] {
    const equations = statements.filter((s) => s.kind !== 'var')
    const variables = statements.filter((s) => s.kind === 'var')
    const items = layout.statements.filter((s) => !this.simplified || s.kind !== 'var')
    const checked = items.map((item) => this.check(item))

    const eqItems = items.map((_, i) => i).filter((i) => items[i]!.kind === 'eq')
    const pairs = alignEquations(
      equations,
      eqItems.map((i) => checked[i] ?? null),
    )
    const pairOf = new Map(pairs.map(([x, l]) => [eqItems[l]!, x]))

    const chunks: Chunk[] = []
    const unusedVariables = [...variables]
    let next = 0 // the next XML equation to write

    const statement = (kind: 'var' | 'eq', xml: XmlStatement, item: StatementLayout, verbatim: boolean): Chunk => {
      const moved = verbatim ? [] : commentsIn(item.text)
      const text = verbatim ? item.text : xml.text
      return { kind, lines: [...triviaOf(item.leading), ...moved, ...withTrailing(text.split('\n'), item.trailing)] }
    }

    items.forEach((item, i) => {
      const check = checked[i]
      if (item.kind === 'var') {
        const name = check?.name ?? item.text.match(/^var\s+([A-Za-z_]\w*)/)?.[1]
        const at = unusedVariables.findIndex((v) => v.name === name)
        if (at < 0) {
          chunks.push({ kind: 'trivia', lines: orphanComments(item) })
          return
        }
        const xml = unusedVariables.splice(at, 1)[0]!
        chunks.push(statement('var', xml, item, check?.fp === xml.fp))
        return
      }

      const x = pairOf.get(i)
      if (x === undefined) {
        chunks.push({ kind: 'trivia', lines: orphanComments(item) })
        return
      }
      while (next < x) chunks.push({ kind: 'eq', lines: equations[next++]!.text.split('\n') })
      const xml = equations[next++]!
      chunks.push(statement('eq', xml, item, xml.clean && check?.fp === xml.fp))
    })
    while (next < equations.length) chunks.push({ kind: 'eq', lines: equations[next++]!.text.split('\n') })

    // Variables the layout doesn't know go after the last variable, or before the first equation.
    if (unusedVariables.length) {
      const extra: Chunk[] = unusedVariables.map((v) => ({ kind: 'var', lines: [v.text] }))
      const lastVariable = chunks.map((c) => c.kind).lastIndexOf('var')
      const firstEquation = chunks.findIndex((c) => c.kind === 'eq')
      const at = lastVariable >= 0 ? lastVariable + 1 : firstEquation >= 0 ? firstEquation : chunks.length
      chunks.splice(at, 0, ...extra)
    }
    return chunks
  }

  /**
   * What a layout statement's text says, or null unless the whole text is one
   * statement of its kind. The text is parsed on its own, so a layout file that
   * was edited by hand can't make the generator write anything but that statement.
   */
  private check(item: StatementLayout): CheckedStatement | null {
    const key = `${item.kind}\n${item.text}`
    const cached = this.checkCache.get(key)
    if (cached !== undefined) return cached

    this.checker ??= new CellMLTextParser({ simplified: false, sourceLineAttribute: null })
    const result = this.checker.parse(`def model m as\ndef comp c as\n${item.text}\nenddef;\nenddef;\n`)
    let checked: CheckedStatement | null = null

    const components = result.layout?.components
    const only = components?.length === 1 && components[0]!.statements.length === 1 ? components[0]!.statements[0]! : null
    // The statement must be the whole text: nothing before it, and nothing after its ';'.
    if (result.doc && only?.kind === item.kind && only.text === item.text && only.leading.length === 0 && !only.trailing) {
      if (item.kind === 'var') {
        const variable = result.doc.getElementsByTagName('variable')[0]
        if (variable) checked = { fp: variableFingerprint(variable), lhs: null, name: variable.getAttribute('name') }
      } else {
        const equation = result.doc.getElementsByTagNameNS(MATHML_NS, 'math')[0]?.firstElementChild
        const lhs = equation?.children[1]
        if (equation && lhs) checked = { fp: mathFingerprint(equation), lhs: mathFingerprint(lhs), name: null }
      }
    }

    if (this.checkCache.size > 10_000) this.checkCache.clear()
    this.checkCache.set(key, checked)
    return checked
  }

  /** Whether two texts parse to the same math and variables, component by component. */
  private sameMeaning(expected: string, actual: string): boolean {
    const parser = new CellMLTextParser({ simplified: this.simplified, sourceLineAttribute: null, recordLayout: false })
    const signature = (text: string) => {
      const doc = parser.parse(text).doc
      if (!doc) return null
      return Array.from(doc.getElementsByTagNameNS(CELLML_2_0_NS, 'component'))
        .map((component) => {
          const equations = Array.from(component.getElementsByTagNameNS(MATHML_NS, 'math')).flatMap((m) =>
            Array.from(m.children).map(mathFingerprint),
          )
          const variables = Array.from(component.getElementsByTagName('variable')).map(variableFingerprint).sort()
          return JSON.stringify([component.getAttribute('name'), equations, variables])
        })
        .join('\n')
    }
    const want = signature(expected)
    return want !== null && want === signature(actual)
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

// --- Layout helpers ------------------------------------------------------------

/** Trivia lines, leaving out any that aren't blank or a comment. */
function triviaOf(lines: TriviaLines | undefined): string[] {
  return (lines ?? []).filter(isTriviaLine)
}

function trailingOf(trailing: string | undefined): string {
  return trailing !== undefined && isTrailing(trailing) ? trailing : ''
}

function withTrailing(lines: string[], trailing: string | undefined): string[] {
  const out = [...lines]
  out[out.length - 1] += trailingOf(trailing)
  return out
}

/** What is left of an item whose statement or block has gone: its comments. */
function orphanComments(item: LayoutItem & { text?: string }): string[] {
  const trailing = trailingOf(item.trailing).trim()
  return [...triviaOf(item.leading), ...commentsIn(item.text ?? ''), ...(trailing ? [trailing] : [])]
}

/** Index pairs [a, b] of a longest common subsequence of two key lists; null keys never match. */
function commonSubsequence(a: Array<string | null>, b: Array<string | null>): Array<[number, number]> {
  const rows = a.length + 1
  const cols = b.length + 1
  const table = new Uint32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] !== null && a[i] === b[j]
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!)
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] !== null && a[i] === b[j]) {
      pairs.push([i++, j++])
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/**
 * Pairs XML equations with layout equations without crossing, so the XML order is
 * kept: first by fingerprint, then (between those) by left-hand side, then by
 * position. Returns [xml index, layout index] pairs in order.
 */
function alignEquations(xml: XmlStatement[], layout: Array<CheckedStatement | null>): Array<[number, number]> {
  const pairs: Array<[number, number]> = []

  const align = (xFrom: number, xTo: number, lFrom: number, lTo: number, depth: number) => {
    if (xFrom >= xTo || lFrom >= lTo) return
    if (depth === 2) {
      const xs: number[] = []
      for (let i = xFrom; i < xTo; i++) if (xml[i]!.kind === 'eq') xs.push(i)
      for (let k = 0; k < xs.length && lFrom + k < lTo; k++) pairs.push([xs[k]!, lFrom + k])
      return
    }
    const key = depth === 0 ? 'fp' : 'lhs'
    const a = xml.slice(xFrom, xTo).map((x) => (x.kind === 'eq' ? x[key] : null))
    const b = layout.slice(lFrom, lTo).map((l) => l?.[key] ?? null)
    let x = xFrom
    let l = lFrom
    for (const [i, j] of commonSubsequence(a, b)) {
      align(x, xFrom + i, l, lFrom + j, depth + 1)
      pairs.push([xFrom + i, lFrom + j])
      x = xFrom + i + 1
      l = lFrom + j + 1
    }
    align(x, xTo, l, lTo, depth + 1)
  }

  align(0, xml.length, 0, layout.length, 0)
  return pairs
}
