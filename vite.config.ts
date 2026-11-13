import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emptyStub = path.resolve(__dirname, 'src/lib/emptyNodeStub.ts');

const wasmAssetFileNames = (assetInfo: { name?: string }) => {
  if (assetInfo.name && assetInfo.name.endsWith('.wasm')) {
    return 'assets/[name][extname]';
  }
  return 'assets/[name]-[hash][extname]';
};

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  resolve: {
    alias: {
      'onnxruntime-node': emptyStub,
      'onnxruntime-web': path.resolve(__dirname, 'node_modules/onnxruntime-web'),
    },
  },
  optimizeDeps: {
    exclude: [
      'cactus-needle',
      'wasm-vad',
      'onnxruntime-web',
      'onnxruntime-node',
      '@huggingface/transformers',
      'kokoro-js',
      '@mlc-ai/web-llm',
    ],
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: wasmAssetFileNames,
      },
    },
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        assetFileNames: wasmAssetFileNames,
      },
    },
  },
  server: {
    port: 5179,
    fs: {
      allow: ['..'],
    },
  },
  preview: {
    port: 4179,
  },
});
