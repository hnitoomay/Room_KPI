import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server:
    command === 'serve'
      ? {
          proxy: {
            '/api': 'http://127.0.0.1:3001',
          },
        }
      : undefined,
}));
