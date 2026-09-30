export enum TokenType {
  Unknown,
  EOF,
  Identifier, // my_var
  Number, // 10.5
  String, // "some text"

  // Keywords
  KwDef,
  KwModel,
  KwComp,
  KwEndDef,
  KwAs,
  KwVar,
  KwUnit,
  KwSel,
  KwCase,
  KwOtherwise,
  KwEndSel,

  // Assignment
  OpAss, // =

  // Symbols
  OpPlus, // +
  OpMinus, // -
  OpTimes, // *
  OpDivide, // /
  OpComma, // ,
  Colon, // :
  SemiColon, // ;
  LParam, // (
  RParam, // )
  LBrace, // {
  RBrace, // }

  // Comparison Operators
  OpEq, // ==
  OpNe, // !=
  OpLt, // <
  OpLe, // <=
  OpGt, // >
  OpGe, // >=

  // Logical Operators
  OpAnd, // and
  OpOr, // or
}

export class CellMLTextScanner {
  private input: string
  private pos: number = 0
  private tokenStart: number = 0
  private line: number = 1
  private length: number
  private currentToken: TokenType = TokenType.EOF
  private currentValue: string = ''
  private _prevTokenEnd: number = 0

  constructor(input: string) {
    this.input = input
    this.length = input.length
    this.nextToken() // Prime the pump
  }

  public get token(): TokenType {
    return this.currentToken
  }
  public get value(): string {
    return this.currentValue
  }
  /** Offset of the current token in the input; it ends where the next one's whitespace begins. */
  public get start(): number {
    return this.tokenStart
  }
  public get end(): number {
    return this.pos
  }
  /** Where the previous token ended, so `input.slice(start, prevTokenEnd)` is what was just consumed. */
  public get prevTokenEnd(): number {
    return this._prevTokenEnd
  }

  // Advance to the next token
  public nextToken(): void {
    this._prevTokenEnd = this.pos
    const linesSkipped = this.skipWhitespace()
    this.line += linesSkipped
    this.tokenStart = this.pos

    if (this.pos >= this.length) {
      this.currentToken = TokenType.EOF
      return
    }

    const char = this.input[this.pos]

    // 1. Identifiers and Keywords
    if (/[a-zA-Z_]/.test(char || '')) {
      let start = this.pos
      while (this.pos < this.length && /[a-zA-Z0-9_]/.test(this.input[this.pos] || '')) {
        this.pos++
      }
      const word = this.input.slice(start, this.pos)
      this.currentValue = word
      this.currentToken = this.getKeywordType(word)
      return
    }

    // 2. Numbers
    if (/[0-9]/.test(char || '') || (char === '.' && /[0-9]/.test(this.input[this.pos + 1] || ''))) {
      let start = this.pos
      // Integer part
      while (this.pos < this.length && /[0-9]/.test(this.input[this.pos] || '')) this.pos++
      // Decimal part
      if (this.input[this.pos] === '.') {
        this.pos++
        while (this.pos < this.length && /[0-9]/.test(this.input[this.pos] || '')) this.pos++
      }
      // Scientific notation (1e-5)
      if (this.input[this.pos] === 'e' || this.input[this.pos] === 'E') {
        this.pos++
        if (this.input[this.pos] === '+' || this.input[this.pos] === '-') this.pos++
        while (this.pos < this.length && /[0-9]/.test(this.input[this.pos] || '')) this.pos++
      }
      this.currentValue = this.input.slice(start, this.pos)
      this.currentToken = TokenType.Number
      return
    }

    // 3. Symbols
    this.pos++ // Consume the char
    this.currentValue = char || ''
    switch (char) {
      // --- ASSIGNMENT VS EQUALITY ---
      case '=':
        if (this.input[this.pos] === '=') {
          this.pos++ // Consume the second '='
          this.currentValue = '=='
          this.currentToken = TokenType.OpEq // The comparison (==)
        } else {
          this.currentToken = TokenType.OpAss // The assignment (=)
        }
        break
      case '!':
        if (this.input[this.pos] === '=') {
          this.pos++
          this.currentValue = '!='
          this.currentToken = TokenType.OpNe
        } else {
          // CellML usually doesn't use '!' alone, but good to handle safely
          console.warn(`Unexpected character '!' at pos ${this.pos}`)
          this.currentToken = TokenType.Unknown
          // this.nextToken() // Don't recurse.
        }
        break
      case '<':
        if (this.input[this.pos] === '=') {
          this.pos++
          this.currentValue = '<='
          this.currentToken = TokenType.OpLe
        } else {
          this.currentToken = TokenType.OpLt
        }
        break
      case '>':
        if (this.input[this.pos] === '=') {
          this.pos++
          this.currentValue = '>='
          this.currentToken = TokenType.OpGe
        } else {
          this.currentToken = TokenType.OpGt
        }
        break
      // --- OTHER SYMBOLS ---
      case '+':
        this.currentToken = TokenType.OpPlus
        break
      case '-':
        this.currentToken = TokenType.OpMinus
        break
      case '*':
        this.currentToken = TokenType.OpTimes
        break
      case '/':
        this.currentToken = TokenType.OpDivide
        break
      case '(':
        this.currentToken = TokenType.LParam
        break
      case ')':
        this.currentToken = TokenType.RParam
        break
      case '{':
        this.currentToken = TokenType.LBrace
        break
      case '}':
        this.currentToken = TokenType.RBrace
        break
      case ':':
        this.currentToken = TokenType.Colon
        break
      case ';':
        this.currentToken = TokenType.SemiColon
        break
      case ',':
        this.currentToken = TokenType.OpComma
        break
      default:
        // The parser reports the Unknown token as an error, with its line.
        this.currentToken = TokenType.Unknown
      // this.nextToken() // Don't recurse.
    }
  }

  public getLine(): number {
    return this.line
  }

  private skipWhitespace(): number {
    let newLinesFound = 0
    while (this.pos < this.length) {
      const c = this.input[this.pos]
      if (/\s/.test(c || '')) {
        if (c === '\n') newLinesFound++
        this.pos++
      } else if (c === '/' && this.input[this.pos + 1] === '/') {
        // Single line comment
        this.pos += 2
        while (this.pos < this.length && this.input[this.pos] !== '\n') this.pos++
      } else {
        break
      }
    }

    return newLinesFound
  }

  private getKeywordType(word: string): TokenType {
    switch (word) {
      case 'def':
        return TokenType.KwDef
      case 'model':
        return TokenType.KwModel
      case 'comp':
        return TokenType.KwComp
      case 'enddef':
        return TokenType.KwEndDef
      case 'as':
        return TokenType.KwAs
      case 'var':
        return TokenType.KwVar
      case 'unit':
        return TokenType.KwUnit
      case 'sel':
        return TokenType.KwSel
      case 'case':
        return TokenType.KwCase
      case 'otherwise':
        return TokenType.KwOtherwise
      case 'endsel':
        return TokenType.KwEndSel
      case 'and':
        return TokenType.OpAnd
      case 'or':
        return TokenType.OpOr
      default:
        return TokenType.Identifier
    }
  }
}
