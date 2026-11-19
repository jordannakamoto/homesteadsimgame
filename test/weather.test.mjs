// Calendar, sun and weather: checked against known physical relationships. node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim, calendar as C, CLIMATES, conditionWord, DAY, HOUR, START_T, TICK } from '../src/sim/index.js';
import { dewPointFrom, saturationVapourHPa } from '../src/sim/weather.js';
import { BENCH, benchOnly } from './helpers/bench.mjs';

const DEG = Math.PI / 180;
const at = (doy, hour, year = 0) => (doy - C.START_DAY_OF_YEAR + 365 * year) * DAY + hour * HOUR;   // world time of a date
const site45 = { latitudeDeg: 45 };
const STEP = 10;   // the weather's cadence in ticks

test('a new world opens on a spring morning, and the year has 365 days and 12 months', () => {
  assert.equal(C.dateText(START_T), '10 April, year 1');
  assert.equal(C.season(START_T), 'spring');
  assert.equal(C.dayOfYear(START_T + 365 * DAY), C.dayOfYear(START_T));
  assert.equal(C.yearIndex(START_T + 365 * DAY), 1);
  assert.equal(C.MONTH_DAYS.reduce((a, b) => a + b), 365);
  assert.deepEqual([0, 59, 151, 243, 334].map((d) => C.season(at(d, 12))), ['winter', 'spring', 'summer', 'autumn', 'winter']);
  assert.equal(C.season(at(181, 12), { latitudeDeg: -35 }), 'winter');
  assert.equal(C.dateText(at(364, 12)), '31 December, year 1');
  assert.equal(C.dateText(at(0, 12, 1)), '1 January, year 2');
});

test('day length at 45 N: about 15.4 h at the June solstice and 8.6 h at the December solstice', () => {
  assert.ok(Math.abs(C.dayLengthHours(at(171, 12), site45) - 15.4) < 0.3, String(C.dayLengthHours(at(171, 12), site45)));
  assert.ok(Math.abs(C.dayLengthHours(at(354, 12), site45) - 8.6) < 0.3, String(C.dayLengthHours(at(354, 12), site45)));
  assert.ok(Math.abs(C.dayLengthHours(at(79, 12), site45) - 12.1) < 0.2);                     // equinox, plus refraction
  assert.ok(Math.abs(C.dayLengthHours(at(171, 12), { latitudeDeg: 0 }) - 12.1) < 0.1);       // the equator
  assert.ok(C.dayLengthHours(at(171, 12), { latitudeDeg: 55.8 }) > 17);                      // Moscow midsummer
  // the sun is up between sunrise and sunset and down outside them
  const st = C.sunTimes(at(200, 12), site45);
  assert.ok(C.sunPosition(at(200, st.sunriseH + 0.2), site45).elevationRad > 0);
  assert.ok(C.sunPosition(at(200, st.sunsetH + 0.3), site45).elevationRad < 0);
  assert.ok(C.sunPosition(at(200, st.sunriseH - 0.3), site45).elevationRad < 0);
});

test('solar noon elevation is 90 - latitude + declination; the sun rises in the east and stands south at noon', () => {
  for (const lat of [0, 38.7, 45, 55.8, -33.9]) for (const doy of [0, 79, 171, 265, 354]) {
    let best = -Infinity, az = 0;
    for (let m = 600; m < 840; m++) { const p = C.sunPosition(at(doy, m / 60), { latitudeDeg: lat }); if (p.elevationRad > best) { best = p.elevationRad; az = p.azimuthRad; } }
    const decl = C.solarDeclinationRad(at(doy, 12)) / DEG;
    const expect = 90 - Math.abs(lat - decl);
    assert.ok(Math.abs(best / DEG - expect) < 0.1, `lat ${lat} day ${doy}: ${(best / DEG).toFixed(2)} vs ${expect.toFixed(2)}`);
    if (lat - decl > 1) assert.ok(Math.abs(az / DEG - 180) < 2, 'noon sun due south');
    if (lat - decl < -1) assert.ok(Math.abs(az / DEG - 180) > 178 || az / DEG < 2 || az / DEG > 358, 'noon sun due north');
  }
  assert.ok(Math.abs(C.solarDeclinationRad(at(171, 12)) / DEG - 23.44) < 0.1);
  assert.ok(Math.abs(C.solarDeclinationRad(at(354, 12)) / DEG + 23.44) < 0.1);
  const morning = C.sunPosition(at(100, 8), site45).azimuthRad / DEG, evening = C.sunPosition(at(100, 16), site45).azimuthRad / DEG;
  assert.ok(morning > 45 && morning < 180 && evening > 180 && evening < 315, `${morning} ${evening}`);
});

test('clear-sky irradiance: 850-1050 W/m2 at a midsummer noon, never negative, nothing at night', () => {
  const noon = C.clearSkyIrradiance(at(171, C.sunTimes(at(171, 12), site45).solarNoonH), site45);
  assert.ok(noon.globalHorizontalWm2 > 850 && noon.globalHorizontalWm2 < 1050, String(noon.globalHorizontalWm2));
  assert.ok(noon.directNormalWm2 > 800 && noon.directNormalWm2 < 1100 && noon.diffuseWm2 > 40 && noon.diffuseWm2 < 200);
  const winter = C.clearSkyIrradiance(at(354, 12), site45).globalHorizontalWm2;
  assert.ok(winter > 200 && winter < 450, String(winter));
  let energy = 0;
  for (let h = 0; h < 365 * 24; h++) {
    const t = at(0, h + 0.5), r = C.clearSkyIrradiance(t, site45), up = C.sunPosition(t, site45).elevationRad > 0;
    for (const v of Object.values(r)) assert.ok(v >= 0 && Number.isFinite(v));
    if (!up) assert.equal(r.globalHorizontalWm2, 0);
    assert.ok(Math.abs(r.globalHorizontalWm2 - r.directNormalWm2 * Math.sin(Math.max(0, C.sunPosition(t, site45).elevationRad)) - r.diffuseWm2) < 1e-6);
    energy += r.globalHorizontalWm2 / 1000;
  }
  // a clear sky all year at 45 N gives roughly 1800-2200 kWh/m2; real sites with cloud get 1200-1500
  assert.ok(energy > 1700 && energy < 2300, String(energy));
});

// One long run per climate, sampled at every weather step, shared by the tests below.
const YEARS = 12;
const runs = new Map();
function climateRun(id, seed = 2024) {
  const key = id + ':' + seed;
  if (runs.has(key)) return runs.get(key);
  const sim = createGameSim(seed);
  sim.command('weather.setSite', { climate: id });
  sim.runTicks(STEP);
  sim.runDays(60);                                     // let the snowpack and the soil settle
  const T = Array.from({ length: 12 }, () => [0, 0]), P = new Array(12).fill(0), N = 365 * YEARS * (1440 / STEP);
  const r = { sim, T, P, samples: [], days: [], dewOk: true, magnusErr: 0, snowfallT: [], ground: Array.from({ length: 12 }, () => [0, 0]), nightDay: Array.from({ length: 12 }, () => [0, 0, 0, 0]) };
  let day = null;
  for (let i = 0; i < N; i++) {
    const before = sim.state.sys.weather.totals.snowfallMm;
    sim.runTicks(STEP);
    const w = sim.state.sys.weather, t = sim.state.t, doy = C.dayOfYear(t), m = C.monthOf(doy), hr = Math.floor(((t % DAY) / HOUR) + 1e-9);
    T[m][0] += w.tempC; T[m][1]++;
    r.ground[m][0] += w.groundTempC; r.ground[m][1]++;
    P[m] += (w.rainMmH + w.snowMmH) * (STEP * TICK / HOUR);
    if (w.dewPointC > w.tempC + 1e-9 || w.humidity < 0 || w.humidity > 1) r.dewOk = false;
    r.magnusErr = Math.max(r.magnusErr, Math.abs(dewPointFrom(w.tempC, w.humidity) - w.dewPointC));
    const fell = w.totals.snowfallMm - before;
    if (fell > 0) r.snowfallT.push([w.tempC, fell]);
    if (hr === 3) { r.nightDay[m][0] += w.tempC; r.nightDay[m][1]++; }
    if (hr === 15) { r.nightDay[m][2] += w.tempC; r.nightDay[m][3]++; }
    if (i % 6 === 0) r.samples.push({ doy, year: C.yearIndex(t), cloud: w.cloud, windMs: w.windMs, p: w.pressureHPa, rain: w.rainMmH + w.snowMmH, rh: w.humidity, snow: w.snowDepthM, solar: w.solar, temp: w.tempC });
    const di = Math.floor(t / DAY);
    if (!day || day.di !== di) { if (day && day.n === 144) r.days.push(day); day = { di, doy, n: 0, lo: Infinity, hi: -Infinity, cloud: 0, cn: 0 }; }
    day.n++; day.lo = Math.min(day.lo, w.tempC); day.hi = Math.max(day.hi, w.tempC);
    if (w.solar.globalHorizontalWm2 > 0 || C.sunPosition(t, w.site).elevationRad > 0) { day.cloud += w.cloud; day.cn++; }
  }
  r.monthC = T.map(([s, n]) => s / n);
  r.annualMm = P.reduce((a, b) => a + b) / YEARS;
  runs.set(key, r);
  return r;
}

for (const id of Object.keys(CLIMATES)) {
  const c = CLIMATES[id];
  test(`${id}: monthly means within 3 C of the ${c.station} normals, and July is much warmer than January`, () => {
    const r = climateRun(id);
    r.monthC.forEach((v, m) => assert.ok(Math.abs(v - c.tempC[m]) < 3, `${C.MONTHS[m]} ${v.toFixed(1)} vs normal ${c.tempC[m]}`));
    const need = c.tempC[6] - c.tempC[0];
    const got = r.monthC[6] - r.monthC[0];
    assert.ok(got > 0.75 * need && got > 8, `July - January = ${got.toFixed(1)} C, normal ${need.toFixed(1)}`);
  });
  test(`${id}: annual precipitation within 25% of the normal`, () => {
    const r = climateRun(id), normal = c.precipMm.reduce((a, b) => a + b);
    assert.ok(Math.abs(r.annualMm / normal - 1) < 0.25, `${r.annualMm.toFixed(0)} mm vs ${normal} mm`);
  });
  test(`${id}: nights are cooler than afternoons in every month; dew point never exceeds the air temperature`, () => {
    const r = climateRun(id);
    let gap = 0;
    r.nightDay.forEach(([n3, k3, n15, k15], m) => { gap += (n15 / k15 - n3 / k3) / 12; assert.ok(n3 / k3 < n15 / k15 - 1, `${C.MONTHS[m]} 03:00 ${(n3 / k3).toFixed(1)} vs 15:00 ${(n15 / k15).toFixed(1)}`); });
    assert.ok(gap > 4 && gap < 14, 'mean 15:00 - 03:00 difference ' + gap.toFixed(1) + ' C');
    assert.ok(r.dewOk, 'dew point above air temperature or humidity out of range');
    assert.ok(r.magnusErr < 0.05, 'humidity and dew point disagree with the Magnus formula by ' + r.magnusErr);
  });
}

test('cloudy days have a smaller diurnal range than clear days', () => {
  for (const id of Object.keys(CLIMATES)) {
    const r = climateRun(id);
    const mean = (a) => a.reduce((s, d) => s + (d.hi - d.lo), 0) / a.length;
    const clear = r.days.filter((d) => d.cloud / d.cn < 0.25), cloudy = r.days.filter((d) => d.cloud / d.cn > 0.8);
    assert.ok(clear.length > 50 && cloudy.length > 50, `${id}: ${clear.length} clear, ${cloudy.length} cloudy days`);
    assert.ok(mean(cloudy) < mean(clear) - 2, `${id}: cloudy ${mean(cloudy).toFixed(1)} C vs clear ${mean(clear).toFixed(1)} C`);
  }
});

test('weather systems are coherent: rain needs cloud and humid air, wind and low pressure come together', () => {
  const r = climateRun('temperate');
  const wet = r.samples.filter((s) => s.rain > 0);
  assert.ok(wet.length > 0.04 * r.samples.length && wet.length < 0.2 * r.samples.length, 'precipitation is falling ' + (wet.length / r.samples.length).toFixed(3) + ' of the time');
  for (const s of wet) { assert.ok(s.cloud > 0.55, 'rain from a sky of cloud ' + s.cloud); assert.ok(s.rh > 0.8, 'rain in air of humidity ' + s.rh); }
  // correlation of wind speed with how low the pressure is
  const xs = r.samples.map((s) => 1015 - s.p), ys = r.samples.map((s) => s.windMs);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  assert.ok(sxy / Math.sqrt(sxx * syy) > 0.3, 'wind and low pressure correlate weakly: ' + (sxy / Math.sqrt(sxx * syy)).toFixed(2));
  const sd = Math.sqrt(sxx / xs.length);
  assert.ok(sd > 5 && sd < 16, 'pressure spread ' + sd.toFixed(1) + ' hPa');
  const wmean = my; assert.ok(wmean > 2 && wmean < 6, 'mean wind ' + wmean.toFixed(1) + ' m/s');
  // cloud cuts the direct beam much more than the diffuse light
  const day = r.samples.filter((s) => s.solar.globalHorizontalWm2 > 50);
  const over = day.filter((s) => s.cloud > 0.9), clear = day.filter((s) => s.cloud < 0.1);
  const frac = (a) => a.reduce((t, s) => t + s.solar.diffuseWm2 / s.solar.globalHorizontalWm2, 0) / a.length;
  assert.ok(over.length > 20 && clear.length > 20 && frac(over) > 0.8 && frac(clear) < 0.35, `diffuse fraction ${frac(over).toFixed(2)} overcast, ${frac(clear).toFixed(2)} clear`);
  assert.ok(r.samples.every((s) => s.solar.directNormalWm2 >= 0 && s.solar.diffuseWm2 >= 0));
});

test('snow only builds up below about 1 C, lies through the temperate winter and is gone by June', () => {
  const r = climateRun('temperate');
  let mass = 0, warm = 0, tw = 0;
  for (const [T, mm] of r.snowfallT) { assert.ok(T < 2, 'snow fell at ' + T.toFixed(2) + ' C'); mass += mm; tw += T * mm; if (T > 1) warm += mm; }
  assert.ok(mass > 50 * YEARS, 'snowfall water equivalent ' + (mass / YEARS).toFixed(0) + ' mm a year');
  assert.ok(tw / mass < 0 && warm / mass < 0.15, `snow falls at a mean of ${(tw / mass).toFixed(1)} C, ${(100 * warm / mass).toFixed(0)}% above 1 C`);
  for (let y = 1; y < YEARS; y++) {
    const jan = r.samples.filter((s) => s.year === y && s.doy < 59), june = r.samples.filter((s) => s.year === y && s.doy >= 160 && s.doy < 250);
    if (!jan.length || !june.length) continue;
    assert.ok(Math.max(...jan.map((s) => s.snow)) > 0.05, 'no lying snow in winter of year ' + y);
    assert.ok(june.every((s) => s.snow === 0), 'snow still lying in summer of year ' + y);
  }
  // no snow at all on the Lisbon coast
  assert.ok(climateRun('mediterranean-coast').samples.every((s) => s.snow < 0.01));
});

test('the deep soil lags the air: a smaller annual swing, coldest later in the year, and never deep-frozen under snow', () => {
  const r = climateRun('temperate'), g = r.ground.map(([s, n]) => s / n);
  const airRange = Math.max(...r.monthC) - Math.min(...r.monthC), soilRange = Math.max(...g) - Math.min(...g);
  assert.ok(soilRange < 0.8 * airRange && soilRange > 0.3 * airRange, `soil ${soilRange.toFixed(1)} C vs air ${airRange.toFixed(1)} C`);
  const coldestAir = r.monthC.indexOf(Math.min(...r.monthC)), coldestSoil = g.indexOf(Math.min(...g));
  assert.ok((coldestSoil - coldestAir + 12) % 12 >= 1 && (coldestSoil - coldestAir + 12) % 12 <= 3, `air coldest in ${C.MONTHS[coldestAir]}, soil in ${C.MONTHS[coldestSoil]}`);
  assert.ok(Math.min(...g) > -4, 'snow-covered soil stays near freezing: ' + Math.min(...g).toFixed(1));
});

test('the same seed gives the same weather; a save continues exactly; old saves without weather still load', () => {
  const a = createGameSim(99), b = createGameSim(99), c = createGameSim(100);
  a.runDays(40); b.runDays(40); c.runDays(40);
  assert.equal(a.hash(), b.hash());
  assert.notEqual(a.hash(), c.hash());
  const mid = createGameSim(99); mid.runDays(17);
  const saved = JSON.stringify(mid.serialize());
  const resumed = createGameSim(5); resumed.load(JSON.parse(saved)); resumed.runDays(23);
  assert.equal(resumed.hash(), a.hash());
  // a wave A save: no weather state at all
  const old = createGameSim(3); old.runDays(2);
  const st = old.serialize(); delete st.sys.weather;
  const fresh = createGameSim(3); fresh.load(st);
  const w = fresh.state.sys.weather;
  assert.ok(w && Number.isFinite(w.tempC) && w.site.climate === 'temperate');
  fresh.runDays(3);
  assert.ok(Number.isFinite(fresh.state.sys.weather.tempC));
});

test('the site can be changed by command, and bad sites are refused', () => {
  const s = createGameSim(8);
  s.command('weather.setSite', { climate: 'cold-continental' }); s.runTicks(1);
  assert.deepEqual(s.state.sys.weather.site, { latitudeDeg: 55.8, climate: 'cold-continental' });
  s.command('weather.setSite', { latitudeDeg: 50 }); s.runTicks(1);
  assert.deepEqual(s.state.sys.weather.site, { latitudeDeg: 50, climate: 'cold-continental' });
  s.command('weather.setSite', { climate: 'tundra' });
  assert.throws(() => s.runTicks(1));
  s.runDays(2);
  assert.ok(Number.isFinite(s.state.sys.weather.tempC));
  assert.ok(['Clear', 'Cloudy', 'Rain', 'Snow', 'Windy'].includes(conditionWord(s.state.sys.weather)));
  // Magnus: saturation at 0 C is 6.11 hPa and at 20 C about 23.4 hPa
  assert.ok(Math.abs(saturationVapourHPa(0) - 6.112) < 1e-9 && Math.abs(saturationVapourHPa(20) - 23.37) < 0.1);
});

test('a year of weather runs fast, well under 0.02 ms a step', benchOnly, () => {
  const s = createGameSim(31);
  const sys = s.systems.find((x) => x.name === 'weather'), step = sys.step;
  let ms = 0, n = 0;
  sys.step = (ctx) => { const t0 = performance.now(); step(ctx); ms += performance.now() - t0; n++; };
  const t0 = performance.now(); s.runDays(365); const total = performance.now() - t0;
  assert.equal(n, 365 * 144);
  assert.ok(ms / n < 0.02, (ms / n).toFixed(4) + ' ms per weather step');
  assert.ok(total < 30000, 'a year took ' + total.toFixed(0) + ' ms');   // about 1 s on a quiet machine with every system registered; loose so a loaded machine does not fail it
});
