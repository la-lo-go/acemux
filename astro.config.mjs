// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import bun from '@nurodev/astro-bun';
import tailwind from '@astrojs/tailwind';

import icon from 'astro-icon';

// Load environment variables
const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');

// https://astro.build/config
export default defineConfig({
    output: 'server',
    adapter: bun(),
    integrations: [tailwind({ applyBaseStyles: false }), icon()],
    server: { 
        port: Number(env.PORT) || 4321, 
        host: true
    },
    vite: {
        server: {
            hmr: {
                port: Number(env.PORT) || 4321
            }
        },
        define: {
            'process.env.ACESTREAM_BASE': JSON.stringify(env.ACESTREAM_BASE),
        },
        ssr: {
            external: ['bun:sqlite']
        },
        optimizeDeps: {
            exclude: ['bun:sqlite']
        }
    }
});