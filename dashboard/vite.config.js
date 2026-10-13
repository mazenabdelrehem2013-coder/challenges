import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The built dashboard is served at /admin (see firebase.json).
// It imports the shared game rules and data layer from ../shared.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/admin/' : '/',
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
}));
