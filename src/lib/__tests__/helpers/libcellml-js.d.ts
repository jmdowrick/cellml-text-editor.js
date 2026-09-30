// libcellml.js ships without type declarations; the tests only need the entry point.
declare module 'libcellml.js' {
  interface Options {
    /** Emscripten's hook for instantiating the wasm yourself; returns {} and calls `receive` when done. */
    instantiateWasm?: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => object
    locateFile?: (path: string, directory: string) => string
  }
  const createLibCellML: (options?: Options) => Promise<any>
  export default createLibCellML
}
