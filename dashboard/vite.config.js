import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, API calls go to the back end on port 4000.
// The built dashboard is served by the back end at /admin.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/admin/' : '/',
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4000' } },
}));
