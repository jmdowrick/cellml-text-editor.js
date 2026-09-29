// libcellml.js ships without type declarations; the tests only need the entry point.
declare module 'libcellml.js' {
  const createLibCellML: (options?: { wasmBinary?: Uint8Array }) => Promise<any>
  export default createLibCellML
}
