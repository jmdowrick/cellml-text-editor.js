import fs from 'node:fs'
import path from 'node:path'

import { CELLML_NS, MATHML_NS } from '../../CellMLMathML'
import { toCellML2 } from './libcellml'

const CORPUS_DIR = path.resolve(__dirname, '../../../assets/cellml')

export const CORPUS_FILES = fs
  .readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith('.cellml'))
  .sort()

export interface CorpusComponent {
  name: string
  /** A CellML 2.0 model holding only this component. */
  xml: string
}

/**
 * The components of a bundled module library that have math, each as its own
 * CellML 2.0 model. The libraries are CellML 1.1, so libcellml converts them first.
 */
export async function corpusComponents(file: string): Promise<CorpusComponent[]> {
  const xml = await toCellML2(fs.readFileSync(path.join(CORPUS_DIR, file), 'utf8'))
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const serializer = new XMLSerializer()

  return Array.from(doc.getElementsByTagNameNS(CELLML_NS, 'component'))
    .filter((component) => component.getElementsByTagNameNS(MATHML_NS, 'math').length > 0)
    .map((component) => {
      const single = new DOMParser().parseFromString(`<model xmlns="${CELLML_NS}" name="m"/>`, 'application/xml')
      single.documentElement.appendChild(single.importNode(component, true))
      return { name: component.getAttribute('name') ?? '', xml: serializer.serializeToString(single) }
    })
}
