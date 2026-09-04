import { styleTags, tags as t } from '@lezer/highlight'

export const cellmlHighlight = styleTags({
  'def enddef var ode comp model as': t.keyword,

  units: t.keyword,

  ComponentName: t.className,
  VariableName: t.variableName,

  MathFunction: t.function(t.variableName),
  MathConstant: t.constant(t.variableName),

  UnitName: t.atom, // Teal/cyan - visually distinct
  UnitValue: t.atom,

  AnnotationKey: t.propertyName, // Muted, not as prominent
  AnnotationValue: t.string, // Subdued color for metadata values

  Number: t.number,
  Operator: t.arithmeticOperator,
  AssignmentOp: t.definitionOperator,
  Comment: t.lineComment,
})
