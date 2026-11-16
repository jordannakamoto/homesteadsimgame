// The Home panel: a plain-words readout of power, water and room temperatures, straight from the
// simulation. It is the first, simple inspector; overlays in the world come later. Reads only, never writes.
(() => {
  const G = window.__game;
  if (!G) return;
  const $ = (id) => document.getElementById(id);
  const panel = $("ut"), btn = $("utb"), body = $("utbody");
  if (!panel || !btn || !body) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const n = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "0");
  const kwh = (wh) => (wh >= 1000 ? n(wh / 1000, 1) + " kWh" : n(wh) + " Wh");
  const litres = (l) => (l >= 1000 ? n(l / 1000, 2) + " m³" : n(l) + " L");
  const row = (label, value, note) => `<div class="utrow"><span class="utl">${esc(label)}</span><span class="utv">${esc(value)}</span>${note ? `<span class="utn">${esc(note)}</span>` : ""}</div>`;
  const meter = (frac) => `<span class="utm"><i style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></i></span>`;
  const issues = (list) => (list || []).slice(0, 3).map((i) => `<div class="utissue"><b>${esc(i.reason || "")}</b> ${esc(i.fix || "")}</div>`).join("");
  let open = false, last = "", acc = 0;

  function html() {
    const S = G.sim.state.sys, e = S.electrical, w = S.water, th = S.thermal, wx = S.weather;
    let h = "";
    // power
    const bats = e ? Object.values(e.batteries || {}) : [], srcs = e ? Object.values(e.sources || {}) : [], loads = e ? Object.values(e.loads || {}) : [];
    h += `<h3>Power</h3>`;
    if (!e || (!bats.length && !srcs.length && !loads.length)) h += `<p class="utnone">Nothing electrical yet. In Build, the Equip tool (E) places panels, batteries and lights; drag from port to port to wire them.</p>`;
    else {
      h += row("Making now", n(e.generationW) + " W", srcs.length ? srcs.length + (srcs.length === 1 ? " source" : " sources") : "nothing generating");
      h += row("Using now", n(e.demandW) + " W", e.unservedW > 0.5 ? n(e.unservedW) + " W going unmet" : "");
      for (const b of bats) h += `<div class="utrow"><span class="utl">Battery</span><span class="utv">${n(b.soc * 100)}%</span>${meter(b.soc)}<span class="utn">${kwh(b.storedWh)} of ${kwh(b.capacityWh)}</span></div>`;
      if (e.today) h += row("Today", "made " + kwh(e.today.generatedWh || 0), "used " + kwh(e.today.usedWh || 0) + (e.today.wastedWh > 1 ? ", " + kwh(e.today.wastedWh) + " went unused (battery full)" : ""));
      h += issues(e.issues);
    }
    // water
    const tanks = w ? Object.values(w.tanks || {}) : [], taps = w ? Object.values(w.taps || {}) : [];
    h += `<h3>Water</h3>`;
    if (!w || (!tanks.length && !taps.length)) h += `<p class="utnone">No tanks or taps yet. A gutter on a roof, a downpipe and a tank will catch the rain.</p>`;
    else {
      for (const t of tanks) h += `<div class="utrow"><span class="utl">Tank</span><span class="utv">${litres(t.storedL)}</span>${meter(t.capacityL ? t.storedL / t.capacityL : 0)}<span class="utn">of ${litres(t.capacityL)}</span></div>`;
      const flowing = taps.filter((t) => t.open && t.flowLmin > 0.05);
      if (taps.length) h += row("Taps", taps.length + (taps.length === 1 ? " tap" : " taps"), flowing.length ? flowing.length + " running at " + n(flowing.reduce((a, t) => a + t.flowLmin, 0), 1) + " L a minute" : "none running");
      if (w.today) h += row("Today", "caught " + litres(w.today.collectedL || 0), "used " + litres(w.today.usedL || 0) + (w.today.overflowL > 1 ? ", " + litres(w.today.overflowL) + " overflowed" : ""));
      h += issues(w.issues);
    }
    // rooms
    const rooms = th ? Object.entries(th.rooms || {}) : [];
    h += `<h3>Indoors</h3>`;
    const out = wx ? wx.tempC : 0;
    if (!rooms.length) h += `<p class="utnone">No rooms yet. A room is a floor with walls all round and a roof over it.</p>`;
    else {
      rooms.slice(0, 8).forEach(([, r], i) => {
        const d = r.tempC - out;
        h += row("Room " + (i + 1), n(r.tempC, 1) + " °C", r.enclosed === false ? "open to the weather" : (Math.abs(d) < 0.5 ? "same as outside" : n(Math.abs(d), 1) + "° " + (d > 0 ? "warmer" : "cooler") + " than outside"));
      });
    }
    h += row("Outside", n(out, 1) + " °C", "");
    // structure
    const st = S.structure;
    const SHOW_STRUCTURE = true;
    if (SHOW_STRUCTURE) h += `<h3>Structure</h3>`;
    const members = st ? Object.keys(st.members || {}).length : 0;
    if (!SHOW_STRUCTURE) { /* hidden for now */ } else if (!st || !members) h += `<p class="utnone">Nothing built yet. When there is, this says how hard each part is working and what would fail first.</p>`;
    else {
      const w0 = st.worst, u = w0 && Number.isFinite(w0.utilisation) ? w0.utilisation : 0;
      const word = u >= 1 ? "overloaded" : u >= 0.85 ? "near its limit" : u >= 0.5 ? "working comfortably" : "lightly loaded";
      h += `<div class="utrow"><span class="utl">Hardest worked</span><span class="utv">${n(Math.min(u, 9.99) * 100)}%</span>${meter(u)}<span class="utn">${word}${w0 && w0.governs ? ", limited by " + esc(String(w0.governs)) : ""}</span></div>`;
      const list = (st.issues || []).slice().sort((a, b) => (b.severity === "fail") - (a.severity === "fail") || (b.utilisation || 0) - (a.utilisation || 0));
      h += list.length ? issues(list) : `<p class="utnone">No problems found: under a heavy snow and a strong gust, everything holds.</p>`;
    }
    return h;
  }
  function render(force) {
    if (!open) return;
    const h = html();
    if (force || h !== last) { body.innerHTML = h; last = h; }
  }
  function show(v) {
    open = v; panel.hidden = !v; btn.setAttribute("aria-pressed", v ? "true" : "false");
    if (v) render(true);
  }
  btn.addEventListener("click", () => { show(!open); const c = $("view"); if (c) c.focus(); });
  const close = $("utclose"); if (close) close.addEventListener("click", () => show(false));
  addEventListener("keydown", (e) => {
    const t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
    if (typing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains("cooking-active")) return;
    if (e.code === "KeyP" && G.player.tool !== "build") show(!open);
    else if (e.code === "Escape" && open) show(false);
  });
  // refresh a few times a second while open; nothing at all while closed
  let prev = performance.now();
  (function tick() {
    const now = performance.now(); acc += now - prev; prev = now;
    if (open && acc > 400) { acc = 0; render(false); }
    requestAnimationFrame(tick);
  })();
  window.__utilities = { show, isOpen: () => open, html };
})();
