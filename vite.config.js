import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { scoresPlugin } from './server/scores-api.mjs';
import { blendPlugin } from './server/blend-api.mjs';

export default defineConfig({
  plugins: [tailwindcss(), scoresPlugin(), blendPlugin()],
  server: {
    host: '0.0.0.0',
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        physics: 'physics.html',
      },
    },
  },
});
