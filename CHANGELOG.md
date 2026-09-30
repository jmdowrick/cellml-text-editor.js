# Changelog

## 0.7.0

Comments, blank lines and the way each equation was typed now survive a round trip through CellML. CellML can't hold them, so the parser records them in a **layout**, which is saved beside the model. Passed back to the generator, it gives the text as it was typed.

### Added

- **`ParserResult.layout`**: the layout of the text, or null when the text doesn't parse. The layout records:
  - `//` comments and blank lines;
  - each statement as typed, including line breaks, alignment and brackets the math doesn't need;
  - the order of `var` lines among the equations;
  - the comments around `def unit` blocks.

  The option `recordLayout: false` turns recording off.
- **`generate(xml, { layout })` and `generateResult(xml, { layout })`** write the text the way it was typed, wherever the math still matches:
  - A statement changed elsewhere is regenerated, and keeps its comments.
  - A statement that has gone leaves its comments behind.
  - New equations appear in the XML's order.
- **`serializeLayout(layout)` and `parseLayout(json)`** save and load a layout as JSON (`"format": "cellml-text-layout"`, `"version": 1`). `parseLayout` returns null for anything else.
- **`mergeSimpleLayout(previous, simple)`** combines the layout of an edit in Simple Mode, which only shows equations, with the previous layout, so the `var` lines keep their comments and places.
- **`GeneratorResult.layoutRejected`** is set if a layout would have changed the math and was ignored. This is not expected to happen.
- **Scanner:** `prevTokenEnd`, where the previous token ended.
- **Playground:** Open and Save buttons for a model and its `.layout.json`.

### Guarantees

- **The XML is unchanged.** The parser writes the same XML as 0.6, with or without recording a layout. The tests pin it with snapshots taken before this change.
- **The default output is unchanged.** Without a layout, the generator writes the same text as 0.6.
- **A layout never changes the math.**
  - A statement's saved text is used only when it parses, on its own, to exactly one statement with the same math.
  - Trivia lines that aren't blank or a comment are ignored.
  - The generator also re-parses its own output, and ignores the layout if the meaning changed.
  - A statement with something the text can't hold (`#unsupported:…#`) is always regenerated, so the marker is never hidden.

### Notes

- **Normal form:** text comes back exactly only in normal form, which the README describes. Other text reaches it after one round trip, keeping every comment. For example, `a = 1; b = 2;` is split onto two lines, and stray `;`s are dropped.
- **What the text holds hasn't changed.**
  - Simple Mode text is one component's equations.
  - The text doesn't hold units or connections.
  - So the layout keeps only the comments around a `def unit` block, and units in the text always come from the XML.

### Fixed

- **Editor highlighting:** `//` comments are highlighted as comments. The editor's grammar had no comment token, so each one showed as a syntax error, even though the parser accepted it.
- **README:** corrected the Quick Start syntax, and replaced the sections describing a `managed` option and `resolveManagedVariables`, which don't exist.

## 0.6.0

`analyzeModel` reports what each equation defines and uses, and `classifyVariables` works out each variable's kind the way libcellml's Analyser does, even while the model is incomplete.

### Added

- **Equation roles in `ModelAnalysis`.** The new fields are:
  - `assigned`: the variables on the left of an equation, including an ODE's state.
  - `voi`: the variables inside a `<bvar>`.
  - `dependencies`: one entry per equation. `target` is the variable it defines, or `null` for an ODE or an implicit equation. `uses` is every other variable in it.

  The existing fields are unchanged.
- **`classifyVariables(analysis, { constants? })`** returns each variable's kind: `voi`, `state`, `constant`, `computed_constant`, `algebraic` or `external`. These are the kinds of libcellml's `AnalyserVariable.Type`.
  - libcellml only answers for a complete, valid model. `classifyVariables` also answers while variables are undeclared, missing initial values or waiting for a connection.
  - Constants default to the declared variables with an initial value. Pass `constants` to decide them yourself.
- **`isInitialisingKind(kind)`** is true for `constant` and `computed_constant`, the kinds that can be another variable's initial value.

### Fixed

- A character the scanner doesn't recognise (such as `#`) no longer logs `Unknown char` to the console. It is still reported as a parse error.

### Testing

- The tests run against libcellml.js 0.7.1, the version phlynx ships.
- `classifyVariables` is checked against libcellml's Analyser on every component in the bundled corpus that libcellml accepts. That is 251 of 260 components, and all of them agree. The cases where the two deliberately differ are listed in `analysis.test.ts`: libcellml rejects the model, or solves a system of equations for a variable that has an initial value.

## 0.5.1

Renaming a variable in Simple Mode keeps its units and initial value.

### Fixed

- **A renamed variable keeps its declaration.** Changing `V` to `Vm` in the equations used to list `Vm` as a new variable with no units or initial value. The session now matches the old and new `<ci>` names, so `Vm` takes over `V`'s units and initial value. This still works when the name is typed a letter at a time, or when an edit briefly fails to parse. A name that is already in use keeps its own units.

### Added

- **Rename everywhere.** When only some uses of a variable are renamed, the new name gets a copy of its units and initial value, and the panel offers to rename the remaining uses. The text is edited in place, so formatting and comments are kept.
- `detectRenames(before, after)` pairs the variables renamed between two lists of `<ci>` names. `renameIdentifier(text, from, to)` renames a variable in Simple Mode text, leaving function names and units annotations alone. Together they let a host that manages variables itself do the same.

## 0.5.0

Variable names in the LaTeX output follow the same convention as vue3-math-editor, so a model looks the same in both.

### Changed

- **One underscore starts a subscript and two start a superscript.** Several of either are joined with commas, in the order written. 0.4 read the parts by position (`base_sub_super_subOfSuper`), so a third or fourth part became a superscript:

  | Name | 0.4 | 0.5 |
  |---|---|---|
  | `q_C_change` | `q_{C}^{change}` | `q_{C,\mathit{change}}` |
  | `tau_m_Na1_6` | `\tau_{m}^{Na1_{6}}` | `\tau_{m,\mathit{Na1},6}` |
  | `g_Kr__max` | `g_{Kr}` | `{g_{\mathit{Kr}}^{\mathit{max}}}` |

- A word of more than one letter is drawn in `\mathit`, so `Kr` reads as one word rather than K·r.
- A name with three or more underscores in a row, or a leading or trailing underscore, is drawn as typed: `\mathit{a\_\_\_b}`.
- Greek names are case-sensitive, and follow vue3-math-editor's list: `varepsilon`, `vartheta`, `varphi` and the capitals `Gamma` … `Omega` are added, and `pi` (the constant) and `omicron` (it looks like `o`) are dropped. A Greek name followed by digits is the letter: `tau2` is `\tau2`.

### Migrating from 0.4

- **To get a superscript, rename the variable to `…__part`**, e.g. `g_Kr_max` to `g_Kr__max`. None of the bundled module libraries uses `__`, so their names now draw with subscripts only. The CellML itself is unaffected; only the LaTeX changes.

### Added

- `formatIdentifier(name)` returns the LaTeX for one variable name, so a host can draw names the same way elsewhere, such as in a list of variables.

### Fixed

- Parts of names are no longer dropped: `Ca___i` was drawn as `Ca`, and `a_b__c` as `a_{b}`.
- Greek names in capitals, such as `ALPHA`, no longer produce `\ALPHA`, which KaTeX rejects.
- Whitespace around the name in a `<ci>` is trimmed rather than copied into the LaTeX.

## 0.4.0

The text editor no longer produces invalid CellML. A successful parse only emits math from the CellML 2.0 MathML subset, and the generator reports anything it can't write instead of dropping it.

### Migrating from 0.3

- **`sqrt(x)` now writes `<root/>`.** 0.3 wrote `<sqrt/>`, which isn't CellML. Existing `<sqrt/>` is still read as `sqrt(x)`, so re-parsing the text rewrites it as `<root/>`.
- **Unknown functions are parse errors.** This includes `ceil` (use `ceiling`), `log10` (use `log(x, 10)`), `diff` (use `ode`) and `mode`. The error suggests the CellML name where there is one.
- **Wrong argument counts are parse errors**, e.g. `'root' takes 2 arguments (the value and the degree), got 1`.
- **Stray tokens are parse errors.** 0.3 skipped them, so `-x = y;` was read as `x = y`.
- **Variable properties are checked.** Unknown properties, an `interface` that isn't `public`, `private`, `public_and_private` or `none`, and an `init` that isn't a number or a variable name are all errors.
- **`and` binds tighter than `or`**, as usual: `a or b and c` is `a or (b and c)`. In 0.3 they were read left to right.
- **Generated text has only the brackets the math needs**: `a + b * c` rather than `(a + (b * c))`.

### Added

- `CellMLTextGenerator.generateResult(xml)` returns `{ text, errors }`. Each error has a `message` and an XPath-style `path`. When `errors` isn't empty, editing the text would lose part of the math, so hosts can refuse to offer it. `generate(xml)` still returns just the text.
- `root(x, n)` (`<degree>`), `log(x, b)` (`<logbase>`) and `ode(x, t, n)` (a `<degree>` in the `<bvar>`), in the parser and both generators.
- The constants `e`, `inf`, `NaN`, `true` and `false` survive a round trip.
- All the CellML trigonometric functions, `not`, `xor`, unary `+`, and brackets around conditions, e.g. `(a > b or c) and d`.
- LaTeX: `\sqrt[n]{x}`, `\log_{b}`, `ceiling`, every argument of `min`/`max`, higher-order derivatives, and the constants.
- A test suite (`yarn test`). It checks every successful parse with libCellML's validator, and round-trips the bundled module libraries. CI runs it on pull requests and before publishing.

### Fixed

- `<root>` with a `<degree>` and `<log>` with a `<logbase>` no longer lose their operand (0.3 wrote `sqrt(/* Unsupported MathML node: degree */)`).
- `/* Unsupported MathML node */` comments, which didn't parse, are gone.
- `(a + b) + c` is no longer merged into `a + b + c`.
- `parse()` builds an XML document in every environment. Under happy-dom it used to build an HTML one, which libCellML can't read.
