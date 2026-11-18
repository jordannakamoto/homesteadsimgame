/* Overlays (window.__overlays): the one switcher for what is shown over the world (power, water, heat...).
   Generic: it draws nothing of its own. Each overlay is registered by whoever can draw it; one is on at a time.

   INTERFACE
     __overlays.register({ id, name, key?, on(), off(), legend? })   // key: a KeyboardEvent.code that turns this one on directly
       -> unregister()
     __overlays.set(id | null), __overlays.cycle(), __overlays.active() -> id | null, __overlays.list() -> [{ id, name }]
     __overlays.onChange(fn(id | null)) -> stop()
   Keys (outside build mode, not while typing): X cycles Off, then each overlay in the order registered.
   A small label in the corner names the one that is on, with its legend line. Nothing runs per frame. */
(() => {
  if (window.__overlays) return;
  const G = window.__game;
  const list = [], fns = [];
  let cur = null, tag = null;

  function label() {
    if (!tag) {
      tag = document.createElement('div');
      tag.id = 'overlay-tag';
      tag.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);padding:4px 10px;border-radius:6px;background:rgba(18,20,24,.72);color:#eee;font:12px/1.4 system-ui,sans-serif;pointer-events:none;z-index:30;white-space:nowrap';
      document.body.appendChild(tag);
    }
    const o = list.find((x) => x.id === cur);
    tag.hidden = !o;
    if (o) tag.textContent = o.name + ' overlay' + (o.legend ? ': ' + (typeof o.legend === 'function' ? o.legend() : o.legend) : '') + '   (X: next)';
  }
  function set(id) {
    const next = id && list.some((x) => x.id === id) ? id : null;
    if (next === cur) return cur;
    const was = list.find((x) => x.id === cur);
    if (was) try { was.off(); } catch (e) { console.error(e); }
    cur = next;
    const o = list.find((x) => x.id === cur);
    if (o) try { o.on(); } catch (e) { console.error(e); }
    label();
    for (const f of fns) f(cur);
    return cur;
  }
  function cycle() {
    if (!list.length) return null;
    const i = list.findIndex((x) => x.id === cur);
    return set(i + 1 < list.length ? list[i + 1].id : null);
  }
  function register(o) {
    if (!o || !o.id || typeof o.on !== 'function' || typeof o.off !== 'function') throw new Error('an overlay needs id, on and off');
    const i = list.findIndex((x) => x.id === o.id);
    if (i >= 0) { if (cur === o.id) set(null); list.splice(i, 1); }
    list.push({ name: o.id, ...o });
    return () => { const k = list.findIndex((x) => x.id === o.id); if (k < 0) return; if (cur === o.id) set(null); list.splice(k, 1); };
  }
  addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (G && G.player && G.player.tool === 'build') return;             // build mode has first refusal (X is its eraser)
    if (e.code === 'KeyX') { cycle(); e.preventDefault(); return; }
    const o = list.find((x) => x.key && x.key === e.code);
    if (o) { set(cur === o.id ? null : o.id); e.preventDefault(); }
  });
  window.__overlays = {
    register, set, cycle, active: () => cur, list: () => list.map((x) => ({ id: x.id, name: x.name })),
    onChange(fn) { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    refreshLabel: label,
  };
})();
