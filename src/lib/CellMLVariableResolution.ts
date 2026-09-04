const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
const CELLML_2_0_NS = 'http://www.cellml.org/cellml/2.0#'

const NUMERIC_LITERAL = /^-?[\d.]+([eE][+-]?\d+)?$/

// --- Analysis: what does a component's math actually need? ---------------

export interface ComponentVariableAnalysis {
  variables: string[] // All variables referenced in the math
  declared: string[] // All variables already declared in the component
  required: string[] // Variables referenced in the math but not declared in the component
  stateVariables: string[] // Variables that appear as the dependent term of a <diff> element
  initialVariables: string[] // Variables that act as the initial-value companion for another declared variable
}

export function analyzeComponentVariables(component: Element): ComponentVariableAnalysis {
  const declared = new Set<string>()
  const declaredEls = component.getElementsByTagName('variable')
  for (let i = 0; i < declaredEls.length; i++) {
    const name = declaredEls[i]?.getAttribute('name')
    if (name) declared.add(name)
  }

  const referenced = new Set<string>()
  const stateVariables = new Set<string>()

  const maths = component.getElementsByTagNameNS(MATHML_NS, 'math')
  for (let i = 0; i < maths.length; i++) {
    collectFromMath(maths[i], referenced, stateVariables)
  }

  const required = Array.from(referenced).filter((name) => !declared.has(name))
  const initialVariables = collectInitialVariables(declaredEls)

  return {
    variables: Array.from(referenced),
    declared: Array.from(declared),
    required,
    stateVariables: Array.from(stateVariables),
    initialVariables,
  }
}

function collectFromMath(math: Element | null | undefined, referenced: Set<string>, stateVariables: Set<string>) {
  if (!math) return

  const cis = math.getElementsByTagNameNS(MATHML_NS, 'ci')
  for (let i = 0; i < cis.length; i++) {
    const name = cis[i]?.textContent?.trim()
    if (name) referenced.add(name)
  }

  const applies = math.getElementsByTagNameNS(MATHML_NS, 'apply')
  for (let i = 0; i < applies.length; i++) {
    const apply = applies[i]
    if (!apply || apply.firstElementChild?.localName !== 'diff') continue

    // <apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply> -> dependent is "V"
    const dependent = Array.from(apply.children).find((c) => c.localName !== 'diff' && c.localName !== 'bvar')
    const name = dependent?.localName === 'ci' ? dependent.textContent?.trim() : undefined
    if (name) stateVariables.add(name)
  }
}

function collectInitialVariables(declaredEls: HTMLCollectionOf<Element>): string[] {
  const initializers = new Set<string>()
  for (let i = 0; i < declaredEls.length; i++) {
    const initialValue = declaredEls[i]?.getAttribute('initial_value')
    if (initialValue && !NUMERIC_LITERAL.test(initialValue)) {
      initializers.add(initialValue)
    }
  }
  return Array.from(initializers)
}

// --- Component groups: the shape the UI needs to render management panes -

export interface ComponentGroup {
  componentName: string
  variables: string[]
  stateVariables: string[]
  initialVariables: string[]
}

export interface ComponentGroupsResult {
  groups: ComponentGroup[]
  requiredVariables: string[]
  existingUnits: Record<string, string>
}

export const getVariableKey = (componentName: string, variableName: string): string =>
  `${componentName}:${variableName}`

export function buildComponentGroups(doc: XMLDocument | Document): ComponentGroupsResult {
  const components = Array.from(doc.getElementsByTagName('component'))
  const groups: ComponentGroup[] = []
  const requiredVariables: string[] = []
  const existingUnits: Record<string, string> = {}

  components.forEach((component) => {
    const componentName = component.getAttribute('name') || 'unnamed_component'
    const analysis = analyzeComponentVariables(component)

    const declaredEls = Array.from(component.getElementsByTagName('variable'))
    declaredEls.forEach((el) => {
      const name = el.getAttribute('name')
      const units = el.getAttribute('units')
      if (name && units) {
        existingUnits[getVariableKey(componentName, name)] = units
      }
    })

    groups.push({
      componentName,
      variables: analysis.variables.slice().sort(),
      stateVariables: analysis.stateVariables,
      initialVariables: analysis.initialVariables,
    })

    analysis.required.forEach((name) => {
      requiredVariables.push(getVariableKey(componentName, name))
    })
  })

  return { groups, requiredVariables, existingUnits }
}

// --- Resolution: asking an external program for the missing variables ----

export type VariableInterface = 'public' | 'private' | 'public_and_private' | 'none'

export interface ExternalVariableInfo {
  name: string
  units: string
  interface?: VariableInterface
  initialValue?: string
  componentName?: string
}

export interface VariableResolutionRequest {
  modelName: string
  componentName: string
  variableNames: string[]
  stateVariableNames: string[]
}

export interface VariableResolutionResult {
  resolved: ExternalVariableInfo[]
  unresolved: string[]
}

export interface VariableResolver {
  resolveVariables(request: VariableResolutionRequest): Promise<VariableResolutionResult>
}

export class MockVariableResolver implements VariableResolver {
  private entries = new Map<string, ExternalVariableInfo>()
  private latencyMs: number

  constructor(entries: ExternalVariableInfo[] = [], options: { latencyMs?: number } = {}) {
    entries.forEach((e) => this.set(e))
    this.latencyMs = options.latencyMs ?? 0
  }

  private key(name: string, componentName?: string): string {
    return componentName ? getVariableKey(componentName, name) : name
  }

  set(info: ExternalVariableInfo) {
    this.entries.set(this.key(info.name, info.componentName), info)
  }

  remove(name: string, componentName?: string) {
    this.entries.delete(this.key(name, componentName))
  }

  clear() {
    this.entries.clear()
  }

  private lookup(name: string, componentName: string): ExternalVariableInfo | undefined {
    return this.entries.get(this.key(name, componentName)) ?? this.entries.get(name)
  }

  async resolveVariables(request: VariableResolutionRequest): Promise<VariableResolutionResult> {
    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs))
    }

    const resolved = new Map<string, ExternalVariableInfo>()
    const unresolved: string[] = []
    const requestedSet = new Set(request.variableNames)

    const queue = [...request.variableNames]
    while (queue.length > 0) {
      const name = queue.shift() as string
      if (resolved.has(name)) continue

      const entry = this.lookup(name, request.componentName)
      if (!entry) {
        if (requestedSet.has(name)) unresolved.push(name)
        continue
      }

      resolved.set(name, entry)
      if (
        entry.initialValue &&
        !resolved.has(entry.initialValue) &&
        this.lookup(entry.initialValue, request.componentName)
      ) {
        queue.push(entry.initialValue)
      }
    }

    return { resolved: Array.from(resolved.values()), unresolved }
  }
}

export function buildResolutionRequest(
  modelName: string,
  componentName: string,
  analysis: ComponentVariableAnalysis,
): VariableResolutionRequest {
  const variableNames = Array.from(new Set([...analysis.variables, ...analysis.initialVariables]))

  return {
    modelName,
    componentName,
    variableNames,
    stateVariableNames: analysis.stateVariables,
  }
}

export function validateResolution(request: VariableResolutionRequest, result: VariableResolutionResult): string[] {
  const problems: string[] = []
  const byName = new Map(result.resolved.map((r) => [r.name, r]))

  for (const name of request.stateVariableNames) {
    const entry = byName.get(name)
    if (!entry) continue // already surfaced via result.unresolved

    if (!entry.initialValue) {
      problems.push(`State variable "${name}" resolved with no initialValue (expected a companion variable name).`)
      continue
    }
    if (!byName.has(entry.initialValue)) {
      problems.push(
        `State variable "${name}" references companion variable "${entry.initialValue}", but it was not included in the resolved list.`,
      )
    }
  }

  return problems
}

// --- Applying a resolution back onto the document -------------------------

export function applyResolvedVariables(
  doc: XMLDocument | Document,
  component: Element,
  resolved: ExternalVariableInfo[],
) {
  const existing = new Map(
    Array.from(component.getElementsByTagName('variable')).map((v) => [v.getAttribute('name') || '', v]),
  )
  const mathEl = component.getElementsByTagNameNS(MATHML_NS, 'math')[0]

  for (const info of resolved) {
    let variable = existing.get(info.name)

    if (!variable) {
      variable = doc.createElementNS(CELLML_2_0_NS, 'variable')
      variable.setAttribute('name', info.name)
      if (mathEl) {
        component.insertBefore(variable, mathEl)
      } else {
        component.appendChild(variable)
      }
      existing.set(info.name, variable)
    }

    variable.setAttribute('units', info.units || 'dimensionless')

    if (info.initialValue) {
      variable.setAttribute('initial_value', info.initialValue)
    } else {
      variable.removeAttribute('initial_value')
    }

    if (info.interface) {
      variable.setAttribute('interface', info.interface)
    }
  }
}

// --- Orchestration: resolve + validate + apply for every component -------

export interface ComponentResolutionOutcome {
  componentName: string
  resolved: ExternalVariableInfo[]
  unresolved: string[]
  problems: string[]
}

export interface ModelResolutionSummary {
  components: ComponentResolutionOutcome[]
  /** Flattened "componentName:variableName" keys across all components. */
  unresolved: string[]
  problems: string[]
}

export async function resolveManagedVariables(
  doc: XMLDocument | Document,
  resolver: VariableResolver,
): Promise<ModelResolutionSummary> {
  const model = doc.documentElement
  const modelName = model?.getAttribute('name') || 'unnamed_model'
  const components = Array.from(doc.getElementsByTagName('component'))

  const outcomes: ComponentResolutionOutcome[] = []
  const allUnresolved: string[] = []
  const allProblems: string[] = []

  for (const component of components) {
    const componentName = component.getAttribute('name') || 'unnamed_component'
    const analysis = analyzeComponentVariables(component)
    const request = buildResolutionRequest(modelName, componentName, analysis)

    const result = await resolver.resolveVariables(request)
    const problems = validateResolution(request, result)

    applyResolvedVariables(doc, component, result.resolved)

    outcomes.push({ componentName, resolved: result.resolved, unresolved: result.unresolved, problems })
    result.unresolved.forEach((name) => allUnresolved.push(getVariableKey(componentName, name)))
    allProblems.push(...problems)
  }

  return { components: outcomes, unresolved: allUnresolved, problems: allProblems }
}
