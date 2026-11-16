import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  server: { watch: { ignored: ['**/.climate-cache/**', '**/data/agency-review-*.json'] } },
  build: { target: 'es2022' },
});
