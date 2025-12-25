import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

// Check if building for browser (bundles all deps) vs library (externals)
const isBrowserBuild = process.env.BROWSER_BUILD === 'true';

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*'],
      outDir: 'dist',
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MrmdEditor',
      fileName: isBrowserBuild ? 'index.browser' : 'index',
      formats: ['es'],
    },
    rollupOptions: isBrowserBuild ? {
      output: {
        // Bundle everything into a single file for browser
        inlineDynamicImports: true,
      },
    } : {
      external: [
        '@codemirror/commands',
        '@codemirror/lang-markdown',
        '@codemirror/language',
        '@codemirror/language-data',
        '@codemirror/state',
        '@codemirror/view',
        '@lezer/common',
        '@lezer/highlight',
        '@lezer/markdown',
        'katex',
      ],
    },
    sourcemap: true,
  },
});
