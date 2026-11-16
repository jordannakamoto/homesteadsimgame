import test from 'node:test';
import assert from 'node:assert/strict';
import { stepStreams, streams } from '../src/sim/streams.js';

const DT = 600, run = (s, w, hours) => { for (let t = 0; t < hours * 3600; t += DT) stepStreams(s, w, DT); return s; };
const dry = { rainMmH: 0, tempC: 15, totals: { meltMm: 0 } };

test('streams: an ordinary start stays near an ordinary flow for a day without rain', () => {
  const s = run(streams.init(), dry, 24);
  assert.ok(s.wetness > 0.8 && s.wetness < 1.2, String(s.wetness));
});
test('streams: a storm brings the brooks up muddy within hours, and they fall back and clear', () => {
  const s = streams.init();
  run(s, dry, 6);
  const before = s.wetness;
  run(s, { ...dry, rainMmH: 8 }, 6);             // 48 mm in six hours
  run(s, dry, 3);
  const peak = s.wetness, mud = s.turbidity;
  assert.ok(peak > before * 2, `peak ${peak} vs ${before}`);
  assert.ok(mud > 0.9, String(mud));
  run(s, dry, 72);
  assert.ok(s.wetness < peak * 0.6 && s.turbidity < mud, `${s.wetness} ${s.turbidity}`);
});
test('streams: a long dry spell shrinks them, but ground water keeps them running', () => {
  const s = run(streams.init(), { ...dry, tempC: 25 }, 24 * 40);
  assert.ok(s.wetness < 0.5 && s.wetness > 0.1, String(s.wetness));
});
test('streams: snowmelt feeds them', () => {
  const s = streams.init(), w = { rainMmH: 0, tempC: 3, totals: { meltMm: 0 } };
  run(s, w, 6);
  const before = s.wetness;
  for (let t = 0; t < 12 * 3600; t += DT) { w.totals.meltMm += 2.5 * DT / 3600; stepStreams(s, w, DT); }
  assert.ok(s.wetness > before * 1.3, `${s.wetness} ${before}`);
});
