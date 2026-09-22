import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer', { recursive: true });
await build({ entryPoints: ['src/main/main.ts', 'src/main/preload.ts', 'src/worker/main.ts'], outbase: 'src', outdir: 'dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await build({ entryPoints: ['src/renderer/main.tsx'], outfile: 'dist/renderer/app.js', bundle: true, platform: 'browser', format: 'esm', minify: true });
await copyFile('src/renderer/index.html', 'dist/renderer/index.html');
