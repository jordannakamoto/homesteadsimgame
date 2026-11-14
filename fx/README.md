# fx add-on

`fx.js` is a plain script loaded after the game bundle (`<script src="fx.js"></script>` before `</body>`).
It needs one hook inside the bundle's IIFE, just before the first `requestAnimationFrame(loop)`:

```js
try { window.__fxHost = { jp: THREE, yi: renderer, oe: scene, hn: camera, en: sunLight, Se: heightAt,
  jn: WATER_LEVEL, ar: quality /* {level} */, dt: camState, get Nt(){return world}, get nt(){return player},
  get ji(){return composer}, get Ts(){return seed}, hook(f){ const b = render; render = function(){ f(); b(); }; } };
} catch (e) { console.warn('fx host', e); }
```

In source form this should use the real variable names; the keys are what fx.js reads.

- `body/body.js` — procedural character generator (source of the character section of fx.js; synced between the markers `// Procedural JRPG-style character:` and `const charMats = charMaterials(T);`).
- `body/view.js`, `run.mjs`, `index.html` — standalone character viewer.
- `tools/` — headless screenshot harnesses (playwright).
