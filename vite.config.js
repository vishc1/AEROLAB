import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { scoresPlugin } from './server/scores-api.mjs';

export default defineConfig({
  plugins: [tailwindcss(), scoresPlugin()],
  server: {
    host: '0.0.0.0',
  },
});
