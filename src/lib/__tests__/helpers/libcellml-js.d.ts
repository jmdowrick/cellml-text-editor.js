// libcellml.js ships without type declarations; the tests only need the entry point.
declare module 'libcellml.js' {
  const createLibCellML: (options?: {
    instantiateWasm?: (
      imports: WebAssembly.Imports,
      done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) => object
  }) => Promise<any>
  export default createLibCellML
}
