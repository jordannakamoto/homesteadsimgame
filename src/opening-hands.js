/* Doors and windows by hand (docs/FRAMING.md): in Hands mode, aim at a built door or window and click to operate
   it: doors swing, slide, pocket, roll up; windows tilt, slide, swing out or rise. The open or closed state lives
   in the simulation (construction.open); window.__build draws the move. Nothing runs here but the reach hooks. */
(() => {
  const R0 = window.__reach, B = window.__build;
  if (!R0 || !B || !B.openUnits) return;
  const VERB = { swing: 'swing', dutch: 'swing', slide: 'slide', pocket: 'slide', barn: 'slide', casement: 'swing', awning: 'tilt', tilt_in: 'tilt', double_hung: 'raise', roll: 'roll', pivot: 'swing' };
  R0.use({
    id: 'openings',
    near(px, pz) { return B.openUnits().some((u) => u.op !== 'fixed' && Math.hypot(u.x - px, u.z - pz) < 4.2); },
    hover(R) {
      let best = null;
      for (const u of B.openUnits()) {
        if (u.op === 'fixed' || u.op === 'fold' || !R.within(u.x, u.z, u.r)) continue;
        const q = R.rayDist(u.x, u.y, u.z);
        if (q.d > Math.max(0.45, u.r * 0.9)) continue;
        const score = q.d + q.t * 0.02;
        if (!best || score < best.score) best = { score, id: u.id, x: u.x, y: u.y, z: u.z, hint: '<b>Click</b>  ' + (u.open ? 'close' : VERB[u.op] === 'swing' ? 'open' : VERB[u.op] === 'raise' ? 'raise' : VERB[u.op] === 'roll' ? 'roll up' : VERB[u.op] === 'tilt' ? 'tilt open' : 'slide open') + ' the ' + u.name };
      }
      return best;
    },
    press(hit) { B.operateUnit(hit.id); },
  });
})();
