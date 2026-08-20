/**
 * tsdown build for dock-markdown (same minimal pattern as dock-editor):
 * host half ESM; client half a single CJS closure factory. react / cordis
 * stay external; dock is imported type-only (erased), all runtime
 * interaction goes through ctx.workbench / ctx.files method calls.
 *
 * marked + dompurify are deliberately NOT external: the client module
 * table only resolves the platform seed words (react / cordis /
 * @deepseek-ai/dsh-client-*), so a require("marked") would miss the table
 * at runtime. They are instead bundled into lib/client.js (build-time
 * resolution via the devDependency links into the web profile node_modules).
 */
const id = 'dock-markdown'

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

export default [{
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: false,
}, {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: CLIENT_EXTERNALS,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}]
