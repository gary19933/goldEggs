import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  build: {
    outDir: 'dist-sdk',
    lib: {
      entry: path.resolve(__dirname, 'src/sdk.js'),
      name: 'GoldenEggs',
      fileName: (format) => `golden-eggs-sdk.${format}.js`,
      formats: ['iife', 'umd'],
    },
    rollupOptions: {
      output: {
        globals: {
          // no externals; Pixi is bundled
        },
      },
    },
  },
});
