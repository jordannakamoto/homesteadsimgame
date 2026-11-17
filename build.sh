#!/bin/sh
# Assembles dist/index.html: template head + engine in one script tag, then the add-on modules in a second.
set -e
cd "$(dirname "$0")"
mkdir -p dist dist/engine
min() { npx esbuild "src/$1.js" --minify-whitespace --charset=utf8 --log-level=warning "$2" > "dist/$1.min.js"; }
# the engine is ordinary module source: bundle it with three.js into one script
npx esbuild src/engine.js --bundle --minify --format=iife --target=es2020 --charset=utf8 --legal-comments=inline --log-level=warning > dist/engine.min.js
mkdir -p dist/engine
npx esbuild src/openings-global.js --bundle --minify --format=iife --target=es2020 --log-level=warning > dist/openings-global.min.js
for m in framing build buildui engine/hands engine/carry engine/assembly engine/cutstation engine/scaffold engine/roofwalk construct-view garden-view touch nature fxpost fxhost fx stock-view weather-view chickens-view utilities-view engine/reach engine/parts opening-hands water-hands; do min $m --legal-comments=eof; done
python3 - <<'P'
r = lambda p: open(p, encoding='utf-8').read()
h, t, g = r('template/head.html'), r('template/tail.html'), r('dist/engine.min.js')
b = '\n'.join(r('dist/%s.min.js' % m) for m in ['openings-global', 'framing', 'build', 'buildui', 'engine/hands', 'engine/carry', 'engine/assembly', 'engine/cutstation', 'engine/scaffold', 'engine/roofwalk', 'construct-view', 'garden-view', 'touch', 'nature', 'fxpost', 'fxhost', 'fx', 'stock-view', 'weather-view', 'chickens-view', 'utilities-view', 'engine/reach', 'engine/parts', 'opening-hands', 'water-hands'])
assert '</script' not in g and '</script' not in b
open('dist/index.html', 'w', encoding='utf-8').write(h + '<script>' + g + '</script>\n<script>' + b + t)
print('dist/index.html', len(h + g + b + t))
P
