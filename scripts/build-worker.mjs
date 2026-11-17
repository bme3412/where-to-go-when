import { build } from 'vite';

await build({
  configFile: false,
  build: {
    target: 'es2022',
    ssr: 'src/site-worker.ts',
    outDir: 'dist/server',
    emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: 'index.js' } },
  },
});
