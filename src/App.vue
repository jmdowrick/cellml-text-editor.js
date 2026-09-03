<template>
  <div class="container">
    <div class="panel">
      <!-- Top Bar: Mode Toggle -->
      <div class="toolbar">
        <label class="toggle-label">
          <input 
            type="checkbox" 
            v-model="isManaged" 
          />
          <strong>External Variable Management</strong>
        </label>
      </div>

      <div v-if="errors.length > 0" class="error-banner">
        <div v-for="(err, index) in errors" :key="index">
          <strong>Line {{ err.line }}:</strong> {{ err.message }}
        </div>
      </div>
      <div v-else class="preview-pane" ref="latexContainer"></div>

      <div class="editor-layout">
        <div class="panel">
          <div class="header-row">
            <h3>CellML Text</h3>
            <label class="toggle-label">
              <input type="checkbox" v-model="isSimplified" />
              Simplified View
            </label>
          </div>
        
          <codemirror
            v-model="textOutput"
            :style="{ height: '400px' }"
            :autofocus="true"
            :indent-with-tab="true"
            :tab-size="2"
            :extensions="extensions"
            @update="handleStateUpdate"
          >
          </codemirror>
        </div>

        <!-- External Variable Management Pane -->
        <div v-if="isManaged" class="panel variable-pane">
          <h3>All Referenced Variables</h3>
          
          <div class="variable-list">
            <div 
              v-for="group in componentGroups" 
              :key="group.componentName" 
              class="component-group"
            >
              <div class="component-title">
                Component: <span>{{ group.componentName }}</span>
              </div>

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
                      ODE State
                    </span>
                    <span v-if="group.initialVariables.includes(varName)" class="badge badge-init">
                      Initializer
                    </span>
                    <span 
                      v-if="!group.stateVariables.includes(varName) && !group.initialVariables.includes(varName)" 
                      class="badge badge-ref"
                    >
                      External Ref
                    </span>
                  </div>
                </div>
                
                <div class="var-inputs">
                  <label>
                    Units:
                    <input 
                      :id="getVarKey(group.componentName, varName)"
                      type="text" 
                      v-model="variableUnits[getVarKey(group.componentName, varName)]"
                      placeholder="e.g. millivolt, second"
                    />
                  </label>

                  <!-- Show companion input if variable requires an initial value declaration -->
                  <label v-if="group.stateVariables.includes(varName)">
                    Initial Value Companion:
                    <input 
                      type="text" 
                      v-model="initialDeclarations[getVarKey(group.componentName, varName)]" 
                      placeholder="e.g. V_init"
                    />
                  </label>
                </div>
              </div>
            </div>

            <button 
              class="btn-apply" 
              @click="applyDeclarations"
              :disabled="!hasValidUnits"
            >
              Apply Unit Declarations
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>CellML 2.0 XML</h3>
      <textarea spellcheck="false">{{ xmlInput }}</textarea>
    </div>
  </div>
</template>

<script setup lang="ts">
// @ts-ignore
import { inject, nextTick, onMounted, ref, watch, computed } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { sublime } from '@uiw/codemirror-theme-sublime'
import katex from 'katex'
import 'katex/dist/katex.min.css'

import { CellMLTextGenerator } from './lib/CellMLTextGenerator'
import { CellMLTextParser, type ParserError, type ExternalVarMetadata } from './lib/CellMLTextParser'
import { CellMLLatexGenerator } from './lib/CellMLLatexGenerator'
import { cellml } from './lib/CellMLLanguage'
import { 
  analyzeComponentVariables, 
  applyResolvedVariables,
  MockVariableResolver,
  buildResolutionRequest,
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

const generator = new CellMLTextGenerator()
const parser = new CellMLTextParser()
const latexGen = new CellMLLatexGenerator()
const resolver = new MockVariableResolver()

const isUpdatingFromXml = ref(false)
let debouncer: any = null
const cursorLine = ref(1)
const latexPreview = ref('')
const latexContainer = ref<HTMLElement | null>(null)
let currentDoc: Document | null = null
const errors = ref<ParserError[]>([])

// Reactive State for External Management
const componentGroups = ref<ComponentGroup[]>([])
const requiredVariables = ref<string[]>([])
const stateVars = ref<string[]>([])
const unitDeclarations = ref<Record<string, string>>({})
const initialDeclarations = ref<Record<string, string>>({})
const interfaceDeclarations = ref<Record<string, string>>({})

const getVarKey = (comp: string, v: string) => `${comp}:${v}`

export interface VariableRef {
  componentName: string
  variableName: string
}

function getExternalVariable(compName: string, varName: string): ExternalVarMetadata | undefined {
  const key = getVarKey(compName, varName)
  return {
    units: variableUnits.value[key] || 'dimensionless',
    initialValue: initialDeclarations.value[key] || undefined,
    interface: interfaceDeclarations.value[key] || 'public',
  }
}

const hasValidUnits = computed(() => {
  return requiredVariables.value.every(v => !!variableUnits.value[v]?.trim())
})

export interface ComponentGroup {
  componentName: string
  variables: string[]
  stateVariables: string[]
  initialVariables: string[]
}

const updateVariableAnalysis = () => {
  if (!currentDoc) return

  const components = Array.from(currentDoc.getElementsByTagName('component'))
  const groups: ComponentGroup[] = []
  const reqVars: string[] = []
  
  const mergedUnits = { ...variableUnits.value }

  components.forEach((comp) => {
    const compName = comp.getAttribute('name') || 'implicit_component'
    const analysis = analyzeComponentVariables(comp)

    const varNodes = Array.from(comp.getElementsByTagName('variable'))
    varNodes.forEach((node) => {
      const varName = node.getAttribute('name')
      const existingUnit = node.getAttribute('units')
      
      if (varName && existingUnit) {
        const key = getVarKey(compName, varName)
        if (!mergedUnits[key]) {
          mergedUnits[key] = existingUnit
        }
      }
    })

    groups.push({
      componentName: compName,
      variables: analysis.variables.slice().sort(),
      stateVariables: analysis.stateVariables,
      initialVariables: analysis.initialVariables || [],
    })

    analysis.required.forEach((varName) => {
      reqVars.push(getVarKey(compName, varName))
    })
  })

  variableUnits.value = mergedUnits
  componentGroups.value = groups
  requiredVariables.value = reqVars
}

function applyDeclarations() {
  const currentParser = new CellMLTextParser({
    simplified: isSimplified.value,
    managed: isManaged.value,
    getExternalVariable,
  })
  
  const result = currentParser.parse(textOutput.value)
  if (result.errors.length === 0 && result.xml) {
    xmlInput.value = result.xml
    currentDoc = currentParser['doc']
    updateVariableAnalysis()
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
  ([newXml, simplified, managed]) => {
    if (isUpdatingFromXml.value) return
    const currentGen = new CellMLTextGenerator({ simplified, managed })
    textOutput.value = currentGen.generate(newXml)
  },
  { immediate: true }
)

watch(
  [textOutput, isSimplified, isManaged],
  ([newVal, simplified, managed]) => {
    if (isUpdatingFromXml.value) return

    if (debouncer) clearTimeout(debouncer)
    debouncer = setTimeout(async () => {
      try {
        const currentParser = new CellMLTextParser({
          simplified: isSimplified.value,
          managed: isManaged.value,
          getExternalVariable,
        })

        const result = currentParser.parse(newVal)

        if (result.errors.length === 0 && result.xml) {
          isUpdatingFromXml.value = true
          xmlInput.value = result.xml
          currentDoc = currentParser['doc']
          updateVariableAnalysis()

          setTimeout(() => (isUpdatingFromXml.value = false), 50)
        }
      } catch (e) {
        // Don't update XML while user is typing invalid syntax
        // console.log('Parsing error (expected while typing):', e.message)
      }
    }, 500)
  }
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
  xmlInput.value = updateCellMLModel(cellMLModelString)
  // xmlInput.value = testXmlInput03
  parser.parse(textOutput.value)
  currentDoc = parser['doc']
  updateVariableAnalysis()
})
</script>

<style scoped>
.container {
  display: flex;
  height: 95vh;
  gap: 20px;
  padding: 20px;
  font-family: sans-serif;
}
.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.toolbar {
  padding: 8px;
  background: #eef2f5;
  border: 1px solid #ccc;
  margin-bottom: 8px;
  border-radius: 4px;
}
.editor-layout {
  display: flex;
  gap: 12px;
  flex: 1;
}
.variable-pane {
  background: #fdfdfd;
  border: 1px solid #ccc;
  padding: 12px;
  max-width: 320px;
}
.variable-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.variable-row {
  border: 1px solid #e0e0e0;
  padding: 8px;
  border-radius: 4px;
  background: #fff;
}
.var-header {
  display: flex;
  justify-content: space-between;
  font-weight: bold;
  margin-bottom: 6px;
}
.badge-state {
  font-size: 0.75em;
  background: #007acc;
  color: #fff;
  padding: 2px 6px;
  border-radius: 3px;
}
.var-inputs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.85em;
}
.var-inputs input {
  width: 100%;
  padding: 4px;
  margin-top: 2px;
}
.btn-apply {
  margin-top: 10px;
  padding: 8px;
  background: #28a745;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.btn-apply:disabled {
  background: #ccc;
  cursor: not-allowed;
}
.empty-state {
  color: #666;
  font-style: italic;
  font-size: 0.9em;
}
textarea {
  flex: 1;
  background: #f4f4f4;
  border: 1px solid #ccc;
  padding: 10px;
  font-family: monospace;
  font-size: 14px;
  white-space: pre;
  overflow: auto;
}
.preview-pane {
  height: 80px;
  background: white;
  border-bottom: 2px solid #ddd;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3em;
}
.error-banner {
  background-color: #ffebee;
  color: #c62828;
  padding: 10px;
  font-family: monospace;
}
</style>
