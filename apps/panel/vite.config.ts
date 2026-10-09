import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * El panel se sirve desde agent-core bajo /panel/v2 (ver panel-spa.ts), así
 * que todo lo que emite el build cuelga de ahí.
 *
 * En desarrollo corre aparte (`npm run dev:panel`) y la API se pide al core
 * local por el proxy: mismo origen, así la cookie de sesión viaja sola.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), 'CORE_');
  const core = `http://localhost:${env.CORE_PORT ?? 3000}`;

  return {
    base: '/panel/v2/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: { '/panel/api': core },
    },
  };
});
