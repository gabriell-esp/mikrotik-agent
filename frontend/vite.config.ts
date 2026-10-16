import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Domínios aceitos pelo servidor do Vite (dev/preview). Separe vários por vírgula.
const allowedHosts = (process.env.ALLOWED_HOSTS ?? 'mikrotik.slot1.info')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

// Endereço do backend para onde o Vite encaminha /api.
const apiTarget = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    allowedHosts,
    proxy: { '/api': apiTarget },
  },
  preview: {
    port: 4173,
    allowedHosts,
    proxy: { '/api': apiTarget },
  },
});
