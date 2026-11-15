#!/bin/sh
# Assembles dist/index.html: template head + engine in one script tag, then the add-on modules in a second.
set -e
cd "$(dirname "$0")"
mkdir -p dist
min() { npx esbuild "src/$1.js" --minify-whitespace --charset=utf8 --log-level=warning "$2" > "dist/$1.min.js"; }
# the engine is ordinary module source: bundle it with three.js into one script
npx esbuild src/engine.js --bundle --minify --format=iife --target=es2020 --charset=utf8 --legal-comments=inline --log-level=warning > dist/engine.min.js
for m in framing build buildui touch nature fxpost fxhost fx stock-view weather-view chickens-view utilities-view; do min $m --legal-comments=eof; done
python3 - <<'P'
r = lambda p: open(p, encoding='utf-8').read()
h, t, g = r('template/head.html'), r('template/tail.html'), r('dist/engine.min.js')
b = '\n'.join(r('dist/%s.min.js' % m) for m in ['framing', 'build', 'buildui', 'touch', 'nature', 'fxpost', 'fxhost', 'fx', 'stock-view', 'weather-view', 'chickens-view', 'utilities-view'])
assert '</script' not in g and '</script' not in b
open('dist/index.html', 'w', encoding='utf-8').write(h + '<script>' + g + '</script>\n<script>' + b + t)
print('dist/index.html', len(h + g + b + t))
P
