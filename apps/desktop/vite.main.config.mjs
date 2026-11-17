// Forge owns the Node/Electron external list and renderer defines. Bundle other
// dependencies so packaging needs no ambient node_modules or native relocator.
export default {
  build: {
    sourcemap: false,
    target: "node24",
    // pg-native is optional and lazily required by pg's CJS entry. Let that
    // original guarded require run only if native mode is requested; Vite's
    // development optional-peer stub otherwise throws at module initialization.
    commonjsOptions: { ignore: ["pg-native"] },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
};
