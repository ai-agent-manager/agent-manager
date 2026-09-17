import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
const svg = await readFile(new URL('../assets/icon.svg', import.meta.url));
const png = new Resvg(svg).render().asPng();
await mkdir(new URL('../build/', import.meta.url), { recursive: true });
await writeFile(new URL('../build/icon.png', import.meta.url), png);
