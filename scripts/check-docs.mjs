import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]); }
let broken = 0;
for (const file of ['README.md', 'AGENTS.md', 'PRODUCT.md', ...walk('docs'), ...walk('design-system')].filter(p => p.endsWith('.md'))) {
  for (const match of readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const dest = match[1].split('#')[0];
    if (!dest || /^[a-z]+:/i.test(dest)) continue;
    if (!existsSync(resolve(dirname(file), dest))) { console.error(`${file}: missing ${dest}`); broken++; }
  }
}
if (broken) process.exitCode = 1; else console.log('Document links OK');
