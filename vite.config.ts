import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** После сборки пишет dist/precache.json — список всех файлов игры для экрана скачивания и офлайн-кеша. */
function precacheManifest(): Plugin {
  return {
    name: 'precache-manifest',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve('dist');
      const files: { url: string; size: number; h: string }[] = [];
      const hash = crypto.createHash('sha1');
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { walk(full); continue; }
          const rel = path.relative(dist, full).split(path.sep).join('/');
          if (rel === 'precache.json' || rel === 'sw.js' || e.name === '.DS_Store') continue;
          const buf = fs.readFileSync(full);
          hash.update(rel).update(buf);
          files.push({ url: rel === 'index.html' ? './' : rel, size: buf.length, h: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10) });
        }
      };
      walk(dist);
      files.sort((a, b) => a.url.localeCompare(b.url));
      const version = hash.digest('hex').slice(0, 12);
      fs.writeFileSync(path.join(dist, 'precache.json'), JSON.stringify({ version, files }));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), precacheManifest()],
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true }, '/api': 'http://localhost:8787' },
  },
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
} as any);
