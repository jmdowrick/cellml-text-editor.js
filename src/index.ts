// Export the core classes.
export { CellMLTextParser } from './lib/CellMLTextParser'
export { CellMLTextGenerator } from './lib/CellMLTextGenerator'
export { CellMLLatexGenerator, formatIdentifier } from './lib/CellMLLatexGenerator'

export { cellml } from './lib/CellMLLanguage'

// The layout sidecar: comments, blank lines and how each statement was typed, saved beside the CellML.
export { serializeLayout, parseLayout, mergeSimpleLayout, LAYOUT_FORMAT, LAYOUT_VERSION } from './lib/CellMLTextLayout'

// Simple Mode: analyse a model's variables and declare them from a host-supplied list.
export { analyzeModel, analyzeModelXml, applyVariableDefinitions } from './lib/CellMLVariableResolution'
// Simple Mode: classify a model's variables the way libcellml's Analyser does, even when the model is incomplete.
export { classifyVariables, isInitialisingKind } from './lib/CellMLVariableClassification'
// Simple Mode: carry a renamed variable's declaration over, and rename it in the rest of the text.
export { detectRenames, renameIdentifier } from './lib/CellMLRename'

// Export interfaces.
export type { ParserOptions, ParseContext, ParserResult, ParserError } from './lib/CellMLTextParser'
export type { VariableRename } from './lib/CellMLRename'
export type { VariableKind } from './lib/CellMLVariableClassification'
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
  EquationDependency,
  ModelAnalysis,
  VariableDefinition,
  VariableInterface,
} from './lib/CellMLVariableResolution'
