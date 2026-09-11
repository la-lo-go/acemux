// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
    output: 'server',
    adapter: node({ mode: 'standalone' }),
    integrations: [icon()],
    // The app has no cookie/session auth, so CSRF origin checks only get in the
    // way of legitimate API clients (curl, scripts) without adding protection.
    security: { checkOrigin: false },
    server: {
        port: Number(process.env.PORT) || 4321,
        host: true
    },
    vite: {
        plugins: [tailwindcss()],
        ssr: {
            external: ['bun:sqlite']
        },
        optimizeDeps: {
            exclude: ['bun:sqlite']
        }
    }
});
