// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import node from '@astrojs/node';
import tailwind from '@astrojs/tailwind';

import icon from 'astro-icon';

// Load environment variables
const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');

// https://astro.build/config
export default defineConfig({
    output: 'server',
    adapter: node({ mode: 'standalone' }),
    integrations: [tailwind({ applyBaseStyles: false }), icon()],
    server: { 
        port: Number(env.PORT) || 3000, 
        host: true
    },
    vite: {
        server: {
            hmr: {
                port: Number(env.PORT) || 3000
            }
        },
        define: {
            'process.env.ACESTREAM_BASE': JSON.stringify(env.ACESTREAM_BASE),
        }
    }
});