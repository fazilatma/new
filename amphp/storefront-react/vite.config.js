import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: path.resolve(__dirname, '../asset/js/storefront'),
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'es2018',
    lib: {
      entry: path.resolve(__dirname, 'src/main.jsx'),
      name: 'AmphpStorefront',
      formats: ['iife'],
      fileName: () => 'storefront.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'storefront.css';
          }
          return assetInfo.name || 'asset';
        },
        inlineDynamicImports: true,
      },
    },
    minify: 'esbuild',
    sourcemap: false,
    cssMinify: true,
  },
});
