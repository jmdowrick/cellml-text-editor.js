# CellML Text Editor

A robust, zero-dependency TypeScript library for parsing, validating, and manipulating **CellML Text** format.

This library provides a bi-directional bridge between the human-readable CellML Text format and standard CellML 2.0 XML. It includes a recursive descent parser, a MathML-to-LaTeX converter, and a pretty-printing code generator.

## Features

* **Robust Parsing:** Handles complex nested logic, comments, and operator precedence.
* **Bi-directional:** Convert CellML Text → XML and XML → CellML Text.
* **LaTeX Generation:** Instantly convert MathML logic into display-ready LaTeX strings.
* **Error Reporting:** Precise syntax error tracking with line numbers.
* **Source Tracking:** Maps output XML/MathML back to original source lines (great for debuggers/editors).
* **Lightweight:** Zero runtime dependencies.

## Installation

```bash
npm install cellml-text-editor
# or
yarn add cellml-text-editor

```

## Quick Start

### 1. Parse Text to XML

```typescript
import { CellMLTextParser } from 'cellml-text-editor';

const code = `
def model my_model
    def comp my_component
        var a: dimension_less {init: 10};
    enddef;
enddef;
`;

const parser = new CellMLTextParser();
const result = parser.parse(code);

if (result.errors.length > 0) {
    console.error("Parse failed:", result.errors);
} else {
    console.log("Generated XML:", result.xml);
}

```

### 2. Convert XML to Text

```typescript
import { CellMLTextGenerator } from 'cellml-text-editor';

const generator = new CellMLTextGenerator();
// 'xml' is a CellML 2.0 model, as a string
const { text, errors } = generator.generateResult(xml);

if (errors.length > 0) {
    // The math holds something CellML Text can't write, e.g. an unknown element.
    // Each error has a message and an XPath-style path to the node.
    // Editing and re-parsing this text would lose it, so don't offer the text for editing.
    console.warn(errors);
} else {
    console.log(text);
}

```

`generate(xml)` still returns just the text. Anything it can't write is marked `#unsupported:…#` in the text, so the text won't parse until the marker is removed. Nothing is dropped silently.

### 3. Generate LaTeX for Equations

Useful for rendering mathematical previews of your CellML models.

```typescript
import { CellMLLatexGenerator } from 'cellml-text-editor';

// Assume 'mathNode' is a MathML Element from your parsed document
const latexGen = new CellMLLatexGenerator();
const latexString = latexGen.convert(mathNode);

console.log(latexString); // e.g. "\frac{dV}{dt} = -I_{ion}"

```

### 4. Simplified vs. Advanced Text

`CellMLTextGenerator` can produce two styles of text, via `simplified`. Advanced writes out every `def model`, `def comp`, and `var` declaration explicitly; simplified reads as short `comp foo { ... }` blocks, and — combined with `managed: true` — hides variable declarations entirely, for cases where they're supplied externally rather than typed by hand.

```typescript
import { CellMLTextGenerator } from 'cellml-text-editor';

const advanced = new CellMLTextGenerator({ simplified: false });
const simplified = new CellMLTextGenerator({ simplified: true, managed: true });

```

### 5. Externally Managed Variables

In managed mode, a component's math can reference variables that aren't declared anywhere in the text. `resolveManagedVariables` looks up whatever's missing via a `VariableResolver` you provide, and writes the result onto the parsed XML.

```typescript
import { CellMLTextParser, resolveManagedVariables, type VariableResolver } from 'cellml-text-editor';

const myResolver: VariableResolver = {
    async resolveVariables(request) {
        // request.componentName, request.variableNames, request.stateVariableNames
        return {
            resolved: [{ name: 'i_Ion', units: 'microA_per_cm2', interface: 'public' }],
            unresolved: [],
        };
    },
};

const parser = new CellMLTextParser();
const { xml, errors } = parser.parse(cellmlTextSource);

if (errors.length === 0) {
    await resolveManagedVariables(parser.doc, myResolver);
    const finalXml = '<?xml version="1.0" encoding="UTF-8"?>\n' + parser.serialize(parser.doc.documentElement);
}

```

Managed mode currently only supports simplified text.

## Supported Math

The parser only emits MathML from the CellML 2.0 subset, so a successful parse is always valid CellML math. Anything else is a parse error.

| Text | MathML | Arguments |
|---|---|---|
| `a + b`, `a - b`, `a * b`, `a / b`, `-a`, `+a` | `plus`, `minus`, `times`, `divide` | |
| `a == b`, `a != b`, `a < b`, `a <= b`, `a > b`, `a >= b` | `eq`, `neq`, `lt`, `leq`, `gt`, `geq` | |
| `a and b`, `a or b` | `and`, `or` | |
| `sqrt(x)` | `<root/>x` | 1 |
| `root(x, n)` | `<root/><degree>n</degree>x` | 2 |
| `log(x)` | `<log/>x` (base 10) | 1 |
| `log(x, b)` | `<log/><logbase>b</logbase>x` | 2 |
| `ode(x, t)` | `<diff/><bvar><ci>t</ci></bvar>x` | 2 |
| `ode(x, t, n)` | `<diff/><bvar><ci>t</ci><degree>n</degree></bvar>x` | 3 |
| `power(a, b)`, `rem(a, b)` | as named | 2 |
| `min(…)`, `max(…)` | as named | 2 or more |
| `abs exp ln floor ceiling` | as named | 1 |
| `sin cos tan sec csc cot`, their hyperbolic (`sinh`, …) and `arc` (`arcsin`, `arcsinh`, …) forms | as named | 1 |
| `not(c)` | `not` | 1 |
| `xor(c, d, …)` | `xor` | 2 or more |
| `sel case c: v; … otherwise: v; endsel` | `piecewise` | |

- **Precedence:** from loosest to tightest, `or`, then `and`, then comparisons, then `+ -`, then `* /`, then unary `-`/`+`. Brackets can group any expression or condition, e.g. `(a > b or c) and d`.
- **Brackets in generated text:** the generator only writes the brackets the math needs, e.g. `a + b * c` and `(a + b) * c`. Brackets you type stay in your text while you edit it, but they aren't stored in the XML.
- **Numbers:** `1`, `2.5`, `.5` and `1.5e-3`, optionally with units: `2 {mV}`. A number without units is `dimensionless`. E-notation is written as `<cn type="e-notation">1.5<sep/>-3</cn>`.
- **Reserved names:** `e`, `pi`, `inf`, `infinity`, `NaN`, `true` and `false` are constants, and the keywords (`def`, `model`, `comp`, `enddef`, `as`, `var`, `unit`, `sel`, `case`, `otherwise`, `endsel`, `and`, `or`) are syntax. None of them can be used as a variable name.
- **Unknown functions** are errors, with a hint where one helps: `Unknown function 'ceil'. Did you mean 'ceiling'?`

## Configuration

You can configure the parser to tag the output XML with source line numbers. This is enabled by default to help build editor integrations (like highlighting the source line when clicking a diagram).

```typescript
import { CellMLTextParser } from 'cellml-text-editor';

// Default behavior: Adds 'data-source-location' attributes to XML
const parser = new CellMLTextParser();

// Custom behavior: Change the attribute name
const debugParser = new CellMLTextParser({
    sourceLineAttribute: 'data-debug-location'
});

// Production behavior: Disable source tracking entirely (clean XML)
const cleanParser = new CellMLTextParser({
    sourceLineAttribute: null
});

```

## Development

If you want to contribute to this library or run the test harness:

1. **Clone the repo**
2. **Install dependencies:**
```bash
yarn

```

3. **Run the test playground:**
This launches a Vue 3 app that lets you type CellML Text and see real-time XML and LaTeX previews.
```bash
yarn dev

```

4. **Run the tests:**
The tests check every successful parse against libCellML's validator, and round-trip the bundled module libraries in `src/assets/cellml/`.
```bash
yarn test

```

5. **Build the library:**
Produces the `dist/` folder ready for publishing.
```bash
yarn build

```

## License

[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)
