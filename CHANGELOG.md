# Changelog

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
