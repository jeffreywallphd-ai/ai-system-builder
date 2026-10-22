// Sandboxed Electron preloads cannot load sibling chunks or arbitrary Node
// modules. Each named target is a self-contained CJS bundle with only Electron
// externalized by Forge; never share the product bridge with the runtime entry.
export default {
  build: {
    sourcemap: false,
    target: "chrome146",
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
};
