// Export the core classes.
export { CellMLTextParser } from './lib/CellMLTextParser'
export { CellMLTextGenerator } from './lib/CellMLTextGenerator'
export { CellMLLatexGenerator, formatIdentifier } from './lib/CellMLLatexGenerator'

export { cellml } from './lib/CellMLLanguage'

// The layout sidecar: comments, blank lines and how each statement was typed, saved beside the CellML.
export { serializeLayout, parseLayout, mergeSimpleLayout, LAYOUT_FORMAT, LAYOUT_VERSION } from './lib/CellMLTextLayout'

// Simple Mode: analyse a model's variables and declare them from a host-supplied list.
export { analyzeModel, analyzeModelXml, applyVariableDefinitions } from './lib/CellMLVariableResolution'

// Export interfaces.
export type { ParserOptions, ParseContext, ParserResult, ParserError } from './lib/CellMLTextParser'
export type { CellMLTextGeneratorOptions, GenerateOptions, GeneratorError, GeneratorResult } from './lib/CellMLTextGenerator'
export type {
  ComponentLayout,
  ComponentRef,
  LayoutItem,
  ModelLayout,
  StatementLayout,
  TextLayout,
  TriviaLines,
  UnitsLayout,
} from './lib/CellMLTextLayout'
export type {
  DeclaredVariable,
  ModelAnalysis,
  VariableDefinition,
  VariableInterface,
} from './lib/CellMLVariableResolution'
