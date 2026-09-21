import { cp, mkdir, rm } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';

// Package the browser app without installing or building the Electron host.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'index.html'), join(output, 'index.html'));
for (const [directory, extension] of [['js', '.js'], ['css', '.css']]) {
  await cp(join(root, directory), join(output, directory), {
    recursive: true,
    filter: (source) => statSync(source).isDirectory() || extname(source) === extension,
  });
}
console.log('Browser app prepared in dist/');
