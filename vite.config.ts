/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Nome do repositório no GitHub Pages. Pode ser sobrescrito com VITE_BASE.
const base = process.env.VITE_BASE ?? '/escal-fran/';

export default defineConfig({
  plugins: [react()],
  base,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
