import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react()],
  // @vernier/godirect lists 'text-encoding' as a fallback only; use the browser's native TextDecoder instead.
  resolve: { alias: { 'text-encoding': fileURLToPath(new URL('./src/sensors/text-encoding-shim.ts', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
