# Changelog

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
