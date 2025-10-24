// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwind from '@astrojs/tailwind';

import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
    output: 'server',
    adapter: node({ mode: 'standalone' }),
    integrations: [tailwind({ applyBaseStyles: false }), icon()],
    server: { 
        port: Number(process.env.PORT) || 3000, 
        host: true
    },
    vite: {
        server: {
            hmr: {
                port: Number(process.env.PORT) || 3000
            }
        }
    }
});