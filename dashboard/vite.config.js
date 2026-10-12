import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, API calls go to the back end on port 4000.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
