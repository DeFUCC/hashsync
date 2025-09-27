import { defineConfig } from 'tsdown';
import { copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: 'tracker.js',
  platform: 'node',
  format: "esm",
  minify: true,
  noExternal: () => true,
  hooks: {
    'build:done': () => copyFile(
      join(__dirname, 'torrent.html'),
      join(__dirname, 'dist', 'torrent.html')
    )
  }
});