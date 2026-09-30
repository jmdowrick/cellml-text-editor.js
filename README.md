# CellML Text Editor

A robust, zero-dependency TypeScript library for parsing, validating, and manipulating **CellML Text** format.

This library provides a bi-directional bridge between the human-readable CellML Text format and standard CellML 2.0 XML. It includes a recursive descent parser, a MathML-to-LaTeX converter, and a pretty-printing code generator.

## Features

* **Robust Parsing:** Handles complex nested logic and operator precedence.
* **Bi-directional:** Convert CellML Text → XML and XML → CellML Text.
* **Keeps your layout:** Comments, blank lines and the way each equation was typed are saved in a layout file beside the CellML, and come back when the text is generated again.
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
def model my_model as
    def comp my_component as
        var a: dimensionless {init: 10};
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

console.log(latexString); // e.g. "\frac{dV}{dt} = -I_{\mathit{ion}}"

```

#### Variable names

Underscores in a variable name are drawn as subscripts and superscripts, the same way as [vue3-math-editor](https://github.com/vue3-repos/vue3-math-editor) draws them:

- The **base** is the name up to its first underscore.
- One underscore starts a **subscript** and two start a **superscript**. Several of either are joined with commas, in the order written.
- A name with three or more underscores in a row, or a leading or trailing underscore, is drawn **as typed**.
- A single letter is in maths italic, digits are upright, a Greek letter's name (optionally followed by digits) is the letter, and any other word is in `\mathit`, so `Kr` reads as one word rather than K·r. Greek names are case-sensitive (`alpha`, `Delta`), and `pi` isn't one of them because it is the constant.

| Name | LaTeX |
|---|---|
| `V_m` | `V_{m}` |
| `C_Ca_i` | `C_{\mathit{Ca},i}` |
| `g_Kr__max` | `{g_{\mathit{Kr}}^{\mathit{max}}}` |
| `tau_m_Na1_6` | `\tau_{m,\mathit{Na1},6}` |
| `a___b` | `\mathit{a\_\_\_b}` |

A name with a superscript is braced, which keeps the output identical to vue3-math-editor's. `formatIdentifier(name)` returns the LaTeX for one name, so a host can draw names the same way elsewhere, such as in a list of variables.

### 4. Simple and Advanced Text

Both the parser and the generator take `simplified`.

- **Advanced** text is a whole model: `def model … as`, its `def comp … as` blocks and their `var` lines.
- **Simple** text is the equations of one component, with nothing around them. The generator writes the model's first component. The parser takes the component's name from `ParseContext.componentName`, and the model's name from `ParseContext.baseXml`, the model being edited.

```typescript
import { CellMLTextGenerator, CellMLTextParser } from 'cellml-text-editor';

const text = new CellMLTextGenerator({ simplified: true }).generate(xml);
const result = new CellMLTextParser({ simplified: true }).parse(text, { baseXml: xml, componentName: 'membrane' });

```

### 5. Declaring Variables Outside the Text

Simple text has no `var` lines, so its variables are declared by the host. `analyzeModel` lists what a component's math uses, and `applyVariableDefinitions` declares variables, typically from `ParseContext.finalise`, which runs before the XML is written.

```typescript
import { CellMLTextParser, analyzeModel, applyVariableDefinitions } from 'cellml-text-editor';

const parser = new CellMLTextParser({ simplified: true });
const result = parser.parse(text, {
    componentName: 'membrane',
    finalise: (doc) => applyVariableDefinitions(doc, [
        { name: 'V', units: 'millivolt', initialValue: '-65' },
        { name: 't', units: 'millisecond' },
    ]),
});

const analysis = analyzeModel(result.doc!); // analysis.unresolved: variables still without units

```

### 6. Keeping Comments and Layout

CellML can't hold comments, so the parser records everything the XML leaves out in a **layout**:

- comments and blank lines;
- each statement as it was typed, with its line breaks, spacing and extra brackets;
- the order of the `var` lines among the equations.

Units always come from the XML, since the text doesn't hold them; the layout keeps only the comments around a `def unit` block.

Save the layout beside the model, e.g. as `model.layout.json`, and pass it back when generating the text:

```typescript
import { CellMLTextGenerator, CellMLTextParser, parseLayout, serializeLayout } from 'cellml-text-editor';

// Saving (xml and layout are null when the text doesn't parse)
const { xml, layout } = new CellMLTextParser().parse(text);
if (xml && layout) {
    writeFile('model.cellml', xml);
    writeFile('model.layout.json', serializeLayout(layout));
}

// Loading
const restored = parseLayout(readFile('model.layout.json')); // null if it isn't a layout
const sameText = new CellMLTextGenerator({ simplified: false }).generate(readFile('model.cellml'), { layout: restored });

```

**The layout never changes the math.**

- Each statement is written as it was typed only when its math still matches the XML.
- An equation changed by another tool is regenerated, but keeps its comments. Comments that were inside it move above it.
- A statement that has gone leaves its comments behind.
- New equations appear in the XML's order.
- As a final check, the generator parses its own text. If the result differs from what it would have written without the layout, it drops the layout and sets `layoutRejected`. This is not expected to happen.
- The layout file needs no trust: lines that aren't comments are ignored, and a statement's text is only used if it parses to exactly the one statement it claims to be.

**The same layout works in both modes.** Simple text shows the component's equations with their comments. Its `var` lines, and their comments, stay in the layout for Advanced text. After an edit in Simple Mode, `mergeSimpleLayout(previous, result.layout)` combines the two.

**Normal form.** Text comes back exactly as typed when:

- it has `\n` line endings and no trailing spaces;
- the `def … as` and `enddef;` lines are laid out as the generator writes them;
- each statement starts on its own line;
- every comment is indented at least as far as the line after it (and to the body indent before an `enddef;`).

Any other text reaches that form after one round trip, keeping every comment. For example, `a = 1; b = 2;` becomes two lines.

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
- **Brackets in generated text:** the generator only writes the brackets the math needs, e.g. `a + b * c` and `(a + b) * c`. Brackets you type aren't stored in the XML, but they are kept in the [layout](#6-keeping-comments-and-layout).
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
This launches a Vue 3 app that lets you type CellML Text and see real-time XML and LaTeX previews. **Save** downloads the CellML and its layout, and **Open** loads them back; select both files.
```bash
yarn dev

```

4. **Run the tests:**
The tests check every successful parse against libCellML's validator, and round-trip the bundled module libraries in `src/assets/cellml/`, with and without comments and a layout.
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
