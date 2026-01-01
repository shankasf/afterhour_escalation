import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5175,
        proxy: {
            '/api': {
                target: 'http://localhost:3004',
                changeOrigin: true,
            },
            '/socket.io': {
                target: 'http://localhost:3004',
                ws: true,
            },
        },
    },
    preview: {
        port: 5175,
    },
});
