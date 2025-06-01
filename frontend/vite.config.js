import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'https://reserve4me.onrender.com', // Your Express backend
        changeOrigin: true,
        secure: false, // If your backend uses HTTPS
      }
    }
  }
});
