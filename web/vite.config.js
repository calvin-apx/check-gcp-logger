import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        open: true,
        // Proxy /api/* to the Express server during dev so the browser can call
        // the backend without CORS. The PORT here must match server/.env's PORT.
        proxy: {
            '/api': {
                target: 'http://localhost:4000',
                changeOrigin: false
            }
        }
    }
});