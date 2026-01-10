import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    root: './src/client',
    publicDir: '../../public',
    build: {
        outDir: '../../dist/client',
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        proxy: {
            '/socket.io': {
                target: 'http://localhost:3000',
                ws: true,
            },
        },
    },
});
