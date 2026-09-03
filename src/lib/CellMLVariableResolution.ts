// Support for "externally managed" simplified-mode components

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
const CELLML_2_0_NS = 'http://www.cellml.org/cellml/2.0#'

export interface ComponentVariableAnalysis {
  referenced: string[]
  declared: string[]
  required: string[]
  stateVariables: string[]
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

  return {
    referenced: Array.from(referenced),
    declared: Array.from(declared),
    required,
    stateVariables: Array.from(stateVariables),
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

// --- Resolution: asking an external program for the missing variables ----

export type VariableInterface = 'public' | 'private' | 'public_and_private' | 'none'

export interface ExternalVariableInfo {
  name: string
  units: string
  interface?: VariableInterface
  initialValue?: string
}

export interface VariableResolutionRequest {
  modelName: string
  componentName: string
  variableNames: string[]
  stateVariableNames: string[]
}

export interface VariableResolutionResult {
  resolved: ExternalVariableInfo[]
  /** Requested names the external program had no information for. */
  unresolved: string[]
}

export interface VariableResolver {
  resolveVariables(request: VariableResolutionRequest): Promise<VariableResolutionResult>
}

export class MockVariableResolver implements VariableResolver {
  private entries: Map<string, ExternalVariableInfo>
  private latencyMs: number

  constructor(entries: ExternalVariableInfo[] = [], options: { latencyMs?: number } = {}) {
    this.entries = new Map(entries.map((e) => [e.name, e]))
    this.latencyMs = options.latencyMs ?? 0
  }

  set(info: ExternalVariableInfo) {
    this.entries.set(info.name, info)
  }

  remove(name: string) {
    this.entries.delete(name)
  }

  clear() {
    this.entries.clear()
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

      const entry = this.entries.get(name)
      if (!entry) {
        if (requestedSet.has(name)) unresolved.push(name)
        continue
      }

      resolved.set(name, entry)
      if (entry.initialValue && this.entries.has(entry.initialValue) && !resolved.has(entry.initialValue)) {
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
  const requiredSet = new Set(analysis.required)
  return {
    modelName,
    componentName,
    variableNames: analysis.required,
    stateVariableNames: analysis.stateVariables.filter((name) => requiredSet.has(name)),
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
  const declared = new Set(
    Array.from(component.getElementsByTagName('variable')).map((v) => v.getAttribute('name') || ''),
  )

  for (const info of resolved) {
    if (declared.has(info.name)) continue

    const variable = doc.createElementNS(CELLML_2_0_NS, 'variable')
    variable.setAttribute('name', info.name)
    variable.setAttribute('units', info.units)
    if (info.interface) variable.setAttribute('interface', info.interface)
    if (info.initialValue !== undefined) variable.setAttribute('initial_value', info.initialValue)

    component.appendChild(variable)
  }
}
