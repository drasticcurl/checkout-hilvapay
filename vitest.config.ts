import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // Node y no jsdom: lo que se testea es lógica de servidor (firmas, estados
    // de pago). Los componentes del checkout se prueban contra el sandbox de
    // Whop, que es el único lugar donde el embed existe de verdad.
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
});
