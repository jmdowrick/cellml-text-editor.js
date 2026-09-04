<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-title">
        <h1>CellML Studio</h1>
        <p>Text, XML, and LaTeX views of a CellML 2.0 model, kept in sync as you edit.</p>
      </div>

      <div class="mode-toggles">
        <label class="switch" :title="isManaged ? 'External variable management requires simplified view' : ''">
          <input type="checkbox" v-model="isSimplified" :disabled="isManaged" />
          <span class="switch-track"></span>
          Simplified view
        </label>
        <label class="switch">
          <input type="checkbox" v-model="isManaged" />
          <span class="switch-track"></span>
          External variable management
        </label>
      </div>
    </header>

    <section class="preview-band">
      <div v-if="errors.length > 0" class="error-banner">
        <div v-for="(err, index) in errors" :key="index" class="error-line">
          <span class="error-loc">Line {{ err.line }}</span>{{ err.message }}
        </div>
      </div>
      <div v-else class="preview-pane" ref="latexContainer"></div>
    </section>

    <section class="workspace" :class="{ 'is-managed': managedActive }">
      <div class="panel">
        <div class="panel-header">
          <h2>CellML text</h2>
        </div>
        <codemirror
          v-model="textOutput"
          class="editor"
          :style="{ height: '460px' }"
          :autofocus="true"
          :indent-with-tab="true"
          :tab-size="2"
          :extensions="extensions"
          @update="handleStateUpdate"
        >
        </codemirror>
      </div>

      <!-- External Variable Management Pane -->
      <div v-if="managedActive" class="panel variable-panel">
        <div class="panel-header">
          <h2>Referenced variables</h2>
          <div class="resolution-status" :class="{ 'is-complete': hasValidUnits }">
            {{
              hasValidUnits
                ? 'All referenced variables have units.'
                : `${requiredVariables.length} variable(s) still need units.`
            }}
          </div>
        </div>

        <div class="variable-list">
          <div
            v-for="group in componentGroups"
            :key="group.componentName"
            class="component-group"
          >
            <div class="component-title">{{ group.componentName }}</div>

            <div
              v-for="varName in group.variables"
              :key="varName"
              class="variable-row"
            >
              <div class="var-header">
                <span class="var-name">{{ varName }}</span>

                <!-- Metadata Role Badges -->
                <div class="badge-group">
                  <span v-if="group.stateVariables.includes(varName)" class="badge badge-state">
                    ODE state
                  </span>
                  <span v-if="group.initialVariables.includes(varName)" class="badge badge-init">
                    Initializer
                  </span>
                  <span
                    v-if="!group.stateVariables.includes(varName) && !group.initialVariables.includes(varName)"
                    class="badge badge-ref"
                  >
                    External ref
                  </span>
                </div>
              </div>

              <div class="var-inputs">
                <label>
                  <span>Units</span>
                  <input
                    :id="getVarKey(group.componentName, varName)"
                    type="text"
                    v-model="variableUnits[getVarKey(group.componentName, varName)]"
                    placeholder="e.g. millivolt, second"
                  />
                </label>

                <!-- Show companion input if variable requires an initial value declaration -->
                <label v-if="group.stateVariables.includes(varName)">
                  <span>Initial value companion</span>
                  <input
                    type="text"
                    v-model="initialDeclarations[getVarKey(group.componentName, varName)]"
                    placeholder="e.g. V_init"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>CellML 2.0 XML</h2>
        </div>
        <textarea class="xml-output" spellcheck="false" readonly>{{ xmlInput }}</textarea>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
// @ts-ignore
import { inject, onMounted, ref, watch, computed } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { sublime } from '@uiw/codemirror-theme-sublime'
import katex from 'katex'
import 'katex/dist/katex.min.css'

import { CellMLTextGenerator } from './lib/CellMLTextGenerator'
import { CellMLTextParser, type ParserError } from './lib/CellMLTextParser'
import { CellMLLatexGenerator } from './lib/CellMLLatexGenerator'
import { cellml } from './lib/CellMLLanguage'
import {
  buildComponentGroups,
  resolveManagedVariables,
  getVariableKey as getVarKey,
  type ComponentGroup,
  type VariableInterface,
  type VariableResolver,
  type VariableResolutionRequest,
  type VariableResolutionResult,
} from './lib/CellMLVariableResolution'

// @ts-ignore
import { initLibCellML, updateCellMLModel } from './utils/cellml'

const libcellmlReadyPromise = inject('$libcellml_ready') as Promise<any>
// @ts-ignore
const cellmlModules = import.meta.glob('./assets/cellml/*.cellml', {
  query: 'raw',
  eager: true,
}) as Record<string, { default: string }>

const extensions = [sublime, cellml()]

const isSimplified = ref(false)
const isManaged = ref(false)
const variableUnits = ref<Record<string, string>>({})

const managedActive = computed(() => isManaged.value && isSimplified.value)

watch(isManaged, (managed) => {
  if (managed) isSimplified.value = true
})

// Sample CellML 2.0 XML to start with
const xmlInput = ref(`<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="hodgkin_huxley_squid_axon_model_1952">
  <component name="membrane">
    <variable name="V" units="millivolt" initial_value="-65" interface="public"/>
    <variable name="t" units="millisecond" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply>
        <apply><plus/>
           <ci>V</ci>
           <ci>i_Ion</ci>
        </apply>
      </apply>
    </math>
  </component>
</model>`)

const testXmlInput02 = `
<model xmlns="http://www.cellml.org/cellml/2.0#"  name="example_model">
  <component name="example_component">
    <variable name="q_K" units="coulomb" interface="public"/>
    <variable name="q_V" units="coulomb" interface="public"/>
    <variable name="t" units="second" interface="public"/>
    <variable name="v_NKE_K_i" units="coulomb_per_second" interface="private"/>
    <variable name="v_Kir_i" units="coulomb_per_second" interface="private"/>
    <variable name="v_AQ_api_i" units="coulomb_per_second" interface="private"/>
    <variable name="v_AQ_bas_i" units="coulomb_per_second" interface="private"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
      <apply>
        <eq/>
        <apply>
          <diff/>
          <bvar>
            <ci>t</ci>
          </bvar>
          <ci>q_K</ci>
        </apply>
        <apply>
          <plus/>
          <ci>v_NKE_K_i</ci>
          <ci>v_Kir_i</ci>
        </apply>
      </apply>
      <apply>
        <eq/>
        <apply>
          <diff/>
          <bvar>
            <ci>t</ci>
          </bvar>
          <ci>q_V</ci>
        </apply>
        <apply>
          <plus/>
          <ci>v_AQ_api_i</ci>
          <ci>v_AQ_bas_i</ci>
          <pi />
        </apply>
      </apply>
      <apply>
        <eq/>
        <ci>u</ci>
        <apply>
          <plus/>
          <ci>u_0</ci>
          <ci>u_C</ci>
          <ci>u_ext</ci>
          <apply>
            <times/>
            <ci>R_v</ci>
            <apply>
              <minus/>
              <ci>v</ci>
              <ci>v_out</ci>
            </apply>
          </apply>
        </apply>
      </apply>
    </math>
  </component>
</model>
`

const testXmlInput03 = `
<model xmlns="http://www.cellml.org/cellml/2.0#"  name="example_model">
  <component name="example_component">
    <variable name="i_M" units="picoA" interface="public"/>
    <variable name="j_KM" units="nanoA_per_farad" interface="public"/>
    <variable name="F" units="farad" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
 <apply>
        <eq/>
        <ci>j_KM</ci>
        <apply>
          <times/>
          <apply>
            <divide/>
            <apply>
              <minus/>
              <ci>i_M</ci>
            </apply>
            <ci>F</ci>
          </apply>
          <cn cellml:units="A_per_nanoA">1e-9</cn>
        </apply>
      </apply>
 <apply>
        <eq/>
        <ci>j_KM</ci>
        <apply>
          <times/>
          <apply>
            <divide/>
            <apply>
              <minus/>
              <ci>i_M</ci>
            </apply>
            <ci>F</ci>
          </apply>
          <cn cellml:units="A_per_nanoA" type="e-notation">1<sep/>-9</cn>
        </apply>
      </apply>
    </math>
  </component>
</model>`

const textOutput = ref('')

const parser = new CellMLTextParser()
const latexGen = new CellMLLatexGenerator()

const isUpdatingFromXml = ref(false)
let textDebouncer: any = null
let managedVarDebouncer: any = null
const cursorLine = ref(1)
const latexContainer = ref<HTMLElement | null>(null)
let currentDoc: Document | null = null
const errors = ref<ParserError[]>([])

// Reactive State for External Management
const componentGroups = ref<ComponentGroup[]>([])
const requiredVariables = ref<string[]>([])
const initialDeclarations = ref<Record<string, string>>({})
const interfaceDeclarations = ref<Record<string, string>>({})

const liveResolver: VariableResolver = {
  async resolveVariables(request: VariableResolutionRequest): Promise<VariableResolutionResult> {
    const resolved: VariableResolutionResult['resolved'] = []
    const unresolved: string[] = []
    const handled = new Set<string>()

    for (const stateName of request.stateVariableNames) {
      const stateKey = getVarKey(request.componentName, stateName)
      const companionName = initialDeclarations.value[stateKey]?.trim()
      const stateUnits = variableUnits.value[stateKey]

      if (companionName && stateUnits && !handled.has(companionName)) {
        resolved.push({ name: companionName, units: stateUnits, interface: 'public' })
        handled.add(companionName)
      }
    }

    for (const name of request.variableNames) {
      if (handled.has(name)) continue

      const key = getVarKey(request.componentName, name)
      const units = variableUnits.value[key]

      if (!units?.trim()) {
        unresolved.push(name)
        continue
      }

      resolved.push({
        name,
        units,
        initialValue: initialDeclarations.value[key] || undefined,
        interface: (interfaceDeclarations.value[key] as VariableInterface) || 'public',
      })
      handled.add(name)
    }

    return { resolved, unresolved }
  },
}

const hasValidUnits = computed(() => {
  return requiredVariables.value.every((v) => !!variableUnits.value[v]?.trim())
})

const updateVariableAnalysis = () => {
  if (!currentDoc) return

  const { groups, requiredVariables: reqVars, existingUnits } = buildComponentGroups(currentDoc)

  // Units already present in the XML seed the inputs; anything the user has already typed wins.
  variableUnits.value = { ...existingUnits, ...variableUnits.value }

  // State variables default to a "<name>_init" companion; the user can still override it.
  const seededInitialDeclarations = { ...initialDeclarations.value }
  groups.forEach((group) => {
    group.stateVariables.forEach((varName) => {
      const key = getVarKey(group.componentName, varName)
      if (!seededInitialDeclarations[key]?.trim()) {
        seededInitialDeclarations[key] = `${varName}_init`
      }
    })
  })
  initialDeclarations.value = seededInitialDeclarations

  componentGroups.value = groups
  requiredVariables.value = reqVars
}

async function syncManagedXml(sourceText: string) {
  try {
    const currentParser = new CellMLTextParser({ simplified: isSimplified.value })
    const result = currentParser.parse(sourceText)

    if (result.errors.length === 0 && result.xml) {
      isUpdatingFromXml.value = true
      currentDoc = currentParser.doc

      if (managedActive.value) {
        updateVariableAnalysis()

        await resolveManagedVariables(currentDoc, liveResolver)
        const resolvedXml =
          '<?xml version="1.0" encoding="UTF-8"?>\n' + currentParser.serialize(currentDoc.documentElement)
        xmlInput.value = resolvedXml
      } else {
        xmlInput.value = result.xml
      }

      updateVariableAnalysis()

      setTimeout(() => (isUpdatingFromXml.value = false), 50)
    }
  } catch (e) {
    // Don't update XML while user is typing invalid syntax
    // console.log('Parsing error (expected while typing):', e.message)
  }
}

const handleStateUpdate = (viewUpdate: any) => {
  if (viewUpdate.selectionSet || viewUpdate.docChanged) {
    const state = viewUpdate.state
    const pos = state.selection.main.head
    const line = state.doc.lineAt(pos)

    // Update cursorLine for your LaTeX preview logic
    cursorLine.value = line.number
    updatePreview()
  }
}

const updatePreview = () => {
  if (!currentDoc) return

  // Find the equation that matches this line.
  // We look for elements with 'data-source-location' at our cursor.
  const equations = Array.from(currentDoc.getElementsByTagNameNS('*', 'apply')) // get all apply nodes

  // Find the node with the highest line number that is <= cursorLine
  let bestMatch: Element | null = null

  for (let i = 0; i < equations.length; i++) {
    const eq = equations[i]
    if (!eq) continue

    const loc = eq.getAttribute('data-source-location')
    if (!loc) continue

    const [startStr, endStr] = loc.split('-')
    const start = parseInt(startStr || '0', 10)
    const end = endStr ? parseInt(endStr, 10) : start

    // If we've passed the cursor line, we can stop.
    if (start > cursorLine.value) {
      break
    }

    // Check if the cursor is inside the range.
    if (cursorLine.value >= start && cursorLine.value <= end) {
      bestMatch = eq
      break
    }
  }

  if (bestMatch && latexContainer.value) {
    const latex = latexGen.convert(bestMatch)
    katex.render(latex, latexContainer.value, { throwOnError: false, displayMode: true })
  } else if (latexContainer.value) {
    latexContainer.value.innerHTML = "<span class='placeholder'>No equation selected</span>"
  }
}

// Regenerate text whenever XML changes
watch(
  [xmlInput, isSimplified, isManaged],
  ([newXml, simplified]) => {
    if (isUpdatingFromXml.value) return
    const currentGen = new CellMLTextGenerator({ simplified, managed: managedActive.value })
    textOutput.value = currentGen.generate(newXml)
  },
  { immediate: true }
)

watch(
  [textOutput, isSimplified, isManaged],
  ([newVal]) => {
    if (isUpdatingFromXml.value) return

    if (textDebouncer) clearTimeout(textDebouncer)
    textDebouncer = setTimeout(() => syncManagedXml(newVal), 500)
  }
)

watch(
  [variableUnits, initialDeclarations, interfaceDeclarations],
  () => {
    if (!managedActive.value || isUpdatingFromXml.value) return

    if (managedVarDebouncer) clearTimeout(managedVarDebouncer)
    managedVarDebouncer = setTimeout(() => syncManagedXml(textOutput.value), 500)
  },
  { deep: true }
)

function listAvailableModules() {
  console.log('Available CellML modules:')
  let index = 0
  Object.keys(cellmlModules).forEach((key) => {
    console.log(`[${index++}] - ${key}`)
  })
}

onMounted(async () => {
  // Load a sample CellML file from assets on startup
  libcellmlReadyPromise.then((instance) => {
    initLibCellML(instance)
  })
  await libcellmlReadyPromise

  listAvailableModules()

  const currentIndex = 23
  const currentModule = Object.keys(cellmlModules)[currentIndex] || ''
  console.log(`Loading CellML module: ${currentModule} [${currentIndex}/${Object.keys(cellmlModules).length}]`)
  const cellMLModelString = cellmlModules[currentModule]?.default
  // xmlInput.value = updateCellMLModel(cellMLModelString)
  xmlInput.value = testXmlInput02
  parser.parse(textOutput.value)
  currentDoc = parser.doc
  updateVariableAnalysis()
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

.app-shell {
  --color-bg: #eef1f4;
  --color-surface: #ffffff;
  --color-surface-sunken: #f6f7f9;
  --color-border: #d7dce2;
  --color-border-strong: #b9c1cb;
  --color-text: #161a1f;
  --color-text-muted: #5b6572;
  --color-accent: #2a5db0;
  --color-accent-hover: #21497e;
  --color-state-bg: #fcedd9;
  --color-state-fg: #8a4b06;
  --color-init-bg: #e3edfb;
  --color-init-fg: #1d4c8c;
  --color-ref-bg: #edeff2;
  --color-ref-fg: #4b5563;
  --color-error-bg: #fbeaea;
  --color-error-fg: #8a1f1f;
  --color-error-border: #e4b8b8;
  --color-pending-bg: #edeff2;
  --color-pending-fg: #5b6572;
  --color-success-bg: #e5f3ea;
  --color-success-fg: #1c7a41;
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;

  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 16px;
  height: 100vh;
  box-sizing: border-box;
  padding: 20px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
}

/* --- Header --- */

.app-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.app-title h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.app-title p {
  margin: 4px 0 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.mode-toggles {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.switch {
  position: relative;
  display: flex;
  align-items: center;
  padding-left: 34px;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  cursor: pointer;
  user-select: none;
}

.switch:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.55;
}

.switch input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.switch-track {
  position: absolute;
  top: 50%;
  left: 0;
  width: 28px;
  height: 16px;
  transform: translateY(-50%);
  background: var(--color-border-strong);
  border-radius: 999px;
  transition: background 0.15s ease;
}

.switch-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.15s ease;
}

.switch input:checked + .switch-track {
  background: var(--color-accent);
}

.switch input:checked + .switch-track::after {
  transform: translateX(12px);
}

.switch input:focus-visible + .switch-track {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* --- Equation preview / diagnostics band --- */

.preview-band {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 88px;
  padding: 12px 20px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.preview-pane {
  width: 100%;
  text-align: center;
  font-size: 1.15em;
}

.error-banner {
  width: 100%;
  padding: 10px 14px;
  background: var(--color-error-bg);
  border: 1px solid var(--color-error-border);
  border-radius: 4px;
  color: var(--color-error-fg);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

.error-line {
  padding: 2px 0;
}

.error-loc {
  display: inline-block;
  min-width: 68px;
  font-weight: 600;
}

/* --- Workspace: editor / variables / xml, left to right --- */

.workspace {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
  min-height: 0;
}

.workspace.is-managed {
  grid-template-columns: 1.2fr 0.9fr 1fr;
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.panel-header {
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
}

.panel-header h2 {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

/* --- Variable management pane --- */

.variable-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  overflow-y: auto;
}

.component-group {
  padding: 10px 12px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border);
  border-radius: 4px;
}

.component-title {
  margin-bottom: 8px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 500;
}

.variable-row {
  padding: 10px 0;
  border-top: 1px solid var(--color-border);
}

.variable-row:first-of-type {
  padding-top: 0;
  border-top: none;
}

.var-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.var-name {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  font-weight: 500;
}

.badge-group {
  display: flex;
  gap: 6px;
}

.badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 500;
  white-space: nowrap;
}

.badge-state {
  background: var(--color-state-bg);
  color: var(--color-state-fg);
}

.badge-init {
  background: var(--color-init-bg);
  color: var(--color-init-fg);
}

.badge-ref {
  background: var(--color-ref-bg);
  color: var(--color-ref-fg);
}

.var-inputs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.var-inputs label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.var-inputs input {
  padding: 6px 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

.var-inputs input:focus-visible {
  border-color: var(--color-accent);
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.resolution-status {
  align-self: flex-start;
  margin-top: 4px;
  padding: 4px 10px;
  background: var(--color-pending-bg);
  border-radius: 999px;
  color: var(--color-pending-fg);
  font-size: 0.75rem;
  font-weight: 500;
  transition: background 0.15s ease, color 0.15s ease;
}

.resolution-status.is-complete {
  background: var(--color-success-bg);
  color: var(--color-success-fg);
}

/* --- XML output --- */

.xml-output {
  flex: 1;
  margin: 0;
  padding: 14px;
  background: var(--color-surface-sunken);
  border: none;
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre;
  overflow: auto;
  resize: none;
}

@media (max-width: 960px) {
  .app-shell {
    height: auto;
    min-height: 100vh;
  }

  .workspace,
  .workspace.is-managed {
    grid-template-columns: 1fr;
  }

  .panel {
    min-height: 360px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .switch-track,
  .switch-track::after,
  .resolution-status {
    transition: none;
  }
}
</style>
