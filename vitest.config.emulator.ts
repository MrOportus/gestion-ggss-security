import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Tests hit real local emulators via HTTP, so they run in node
    environment: 'node',
    // Emulators might take a bit longer, especially for cold starts or complex queries
    testTimeout: 30000,
    // Emulators handle parallel requests, but to ensure clean state and avoid conflicts
    // between different test suites on the same data, we disable file parallelism for this specific gate.
    fileParallelism: false,
    
    // Globals like describe, it, expect
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
