import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020',
});
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = readFileSync('src/template.html', 'utf8').replace('/*__BUNDLE__*/', () => js);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log('built dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
