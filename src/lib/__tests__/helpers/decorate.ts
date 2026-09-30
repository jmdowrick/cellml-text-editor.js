import { random } from './random'

/**
 * Generated text as a person might have typed it: comments, blank lines, aligned
 * `=`, wrapped lines and extra brackets, none of which change the math.
 *
 * The result is in normal form (see CellMLTextLayout): comments sit at the
 * indent of what follows them (the body indent before an `enddef;`), and every
 * statement starts on its own line. So the layout recorded from it must give the
 * same text back exactly.
 */
export function decorate(text: string, seed: number): string {
  const next = random(seed)
  const chance = (p: number) => next() < p
  let n = 0
  const note = () => `// note ${++n}`

  const lines = text.replace(/\n$/, '').split('\n')
  const out: string[] = []

  for (const line of lines) {
    const indent = line.match(/^ */)![0]
    const body = line.slice(indent.length)
    const closing = body === 'enddef;'
    const commentIndent = closing ? indent + '  ' : indent

    if (chance(0.15) && out.length > 0) out.push('')
    if (chance(0.15)) out.push(`${commentIndent}${note()}`)

    let decorated = line
    const equation = body.endsWith(';') && body.includes(' = ') && !/\bsel\b/.test(body) && !/^(var|case|otherwise)\b/.test(body)
    if (equation) {
      if (chance(0.3)) decorated = decorated.replace(/ \* ([A-Za-z_]\w*)(?![\w(])/, ' * ($1)')
      if (chance(0.3)) {
        const at = decorated.indexOf(' = ')
        decorated = `${decorated.slice(0, at)} = (${decorated.slice(at + 3, -1)});`
      }
      if (chance(0.2)) decorated = decorated.replace(' = ', '   = ')
      if (chance(0.3) && decorated.includes(' + ')) {
        const comment = chance(0.5) ? ` ${note()}` : ''
        decorated = decorated.replace(' + ', ` +${comment}\n${indent}    `)
      }
    }
    if (chance(0.2)) decorated += `  ${note()}`
    out.push(decorated)
  }

  if (chance(0.3)) out.push('', note())
  return out.join('\n') + '\n'
}
