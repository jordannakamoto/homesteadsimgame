// Weather: temperature, humidity, wind, cloud, rain and snow for the homestead's site.
//
// Not scripted: every quantity comes from a small physical model driven by the calendar and by
// seeded random weather systems (ctx.rng only), so the same seed gives the same year.
//
//   Seasonal cycle   daily insolation at the top of the atmosphere for the site latitude, passed
//                    through a first-order thermal lag (the ground and sea store heat) and mapped
//                    linearly to temperature. The lag, slope and offset are fitted once, when a
//                    climate is first used, to that climate's real monthly normals.
//   Weather systems  a frontal index f (a smoothed Ornstein-Uhlenbeck process, a few days long,
//                    unit variance). High f is a low-pressure system: low pressure, cloud, wind,
//                    humid air and, when f passes the month's threshold, precipitation. Its rate
//                    of change rotates the wind (backing to the south ahead of a front, veering to
//                    the north-west behind it) and brings warm air ahead and cold air behind.
//   Air masses       a slower temperature anomaly with a seasonal spread (winters vary more).
//   Day and night    a boundary-layer heat balance: solar heating under the actual cloud, net
//                    long-wave cooling that cloud blocks, and relaxation toward the air mass.
//                    Clear nights fall colder, overcast days have a small range.
//   Humidity         a dew point carried by the air mass; relative humidity from the Magnus
//                    formula, so dew point never exceeds the air temperature.
//   Snow             precipitation falls as snow at and below 0 C, as rain above 2 C, and mixed
//                    between. The pack keeps its water equivalent and density; it settles, melts
//                    by a degree-day model plus the heat carried by rain, and its depth is SWE / density.
//   Deep soil        exponential lag toward the air temperature, insulated by snow cover.
//
// Units: tempC, dewPointC, groundTempC in C; humidity relative 0..1; windMs in m/s; windDirRad is the
// direction the wind blows FROM, clockwise from north (meteorological); cloud 0..1 cover;
// rainMmH and snowMmH in mm of water per hour; snowDepthM in m; pressureHPa at sea level; solar in W/m2.

import { DAY, HOUR, dayFraction } from './time.js';
import { dayOfYear, clearSkyIrradiance, dailyInsolationTOA, MONTH_START, MONTH_DAYS, DAYS_IN_YEAR, START_DAY_OF_YEAR } from './calendar.js';

// ---------------------------------------------------------------------------------------- climates
// Monthly normals: mean daily temperature (C) and precipitation (mm, water equivalent), January first.
// Values are the 1991-2020 normals of the named station, rounded.
export const CLIMATES = Object.freeze({
  temperate: Object.freeze({
    id: 'temperate', name: 'Temperate', station: 'Burlington, Vermont (44.5 N)', latitudeDeg: 45,
    tempC: [-7.4, -6.0, -0.6, 6.9, 13.8, 19.1, 21.8, 20.6, 16.3, 9.4, 3.3, -3.1],
    precipMm: [56, 46, 58, 77, 91, 98, 104, 99, 92, 94, 77, 64],
    anomalySdC: [5.0, 2.8],          // spread of air-mass temperature, winter and summer
    dewDepressionC: [3.0, 5.0],      // mean dew point depression of the air mass, winter and summer
    windMs: 3.9, prevailingFromDeg: 260, rainRateMmH: 2.2, boundaryLayerHours: 6,
  }),
  'mediterranean-coast': Object.freeze({
    id: 'mediterranean-coast', name: 'Mediterranean coast', station: 'Lisbon, Portugal (38.7 N)', latitudeDeg: 38.7,
    tempC: [11.5, 12.5, 14.6, 16.0, 18.4, 21.5, 23.3, 23.7, 22.3, 19.2, 15.1, 12.4],
    precipMm: [96, 75, 57, 69, 50, 16, 4, 6, 31, 96, 115, 117],
    anomalySdC: [2.2, 2.0],
    dewDepressionC: [3.5, 8.5],
    windMs: 4.6, prevailingFromDeg: 330, rainRateMmH: 3.0, boundaryLayerHours: 3.5,   // the sea air damps the day's swing
  }),
  'cold-continental': Object.freeze({
    id: 'cold-continental', name: 'Cold continental', station: 'Moscow, Russia (55.8 N)', latitudeDeg: 55.8,
    tempC: [-6.2, -5.9, -0.9, 6.9, 13.6, 17.3, 19.7, 17.6, 11.9, 5.8, -0.5, -4.4],
    precipMm: [53, 44, 39, 37, 61, 78, 84, 82, 68, 71, 55, 52],
    anomalySdC: [5.8, 2.8],
    dewDepressionC: [2.5, 5.5],
    windMs: 3.4, prevailingFromDeg: 240, rainRateMmH: 1.7, boundaryLayerHours: 6.5,
  }),
});
export const DEFAULT_CLIMATE = 'temperate';

// ---------------------------------------------------------------------------------------- constants
const EVERY = 10;                      // ticks: the weather steps every 10 minutes of world time
const STATE_V = 1;
const TAU_G = 1.5 * DAY;               // driving noise of the frontal index
const TAU_L = 0.75 * DAY;              // smoothing of the frontal index (sets how fast fronts pass)
// Exact stationary moments of the discrete pair (g driving, f smoothed) at the weather's step, so the
// frontal index has unit variance and the precipitation calibration below holds.
const [F_SCALE, TREND_SCALE] = (() => {
  const a = Math.exp(-(EVERY * 60) / TAU_G), k = 1 - Math.exp(-(EVERY * 60) / TAU_L), c = 1 - k;
  const cgf = k / (1 - a * c);                                   // E[f g] at the same step
  const vf = (k * k + 2 * a * c * k * cgf) / (1 - c * c);        // Var f
  return [1 / Math.sqrt(vf), 1 / Math.sqrt(1 + vf - 2 * cgf)];   // f / sd(f), (g - f) / sd(g - f)
})();
const TAU_AIRMASS = 3 * DAY;
const TAU_CLOUDNOISE = 6 * HOUR;
const TAU_CLOUD = 1.5 * HOUR;          // cloud cover follows its target over an hour or two
const TAU_WINDDIR = 12 * HOUR;
const TAU_GUST = 1 * HOUR;
const K_SOLAR = 0.0036 / HOUR;         // K/s of warming per W/m2 of global irradiance reaching the ground
const LW_CLEAR = 1.2 / HOUR;           // K/s of net long-wave cooling of the shallow night-time layer, clear sky
// By day the cooling is spread through a deep mixed layer, so it changes the air near the ground far less.
const lwDepth = (clearGhi) => 1 - 0.65 * clamp(clearGhi / 200, 0, 1);
const CLOUD_SLOPE = 2.2, CLOUD_NOISE = 0.6;
// how far ahead of the rain the cloud comes, in units of the frontal index: in winter a front's cloud deck spreads far
// ahead of it and lingers behind (long grey spells), in summer the sky between systems is mostly fair, sun with
// some cloud (Burlington: about 70% of December days cloudy against about 30% of July days)
const CLOUD_LEAD_WINTER = 1.55, CLOUD_LEAD_SUMMER = 1.15;
const P_MEAN = 1015, P_PER_F = 10;     // hPa
const TAU_SOIL = 45 * DAY;             // deep soil (about 1 m) lags the air by about a month and a half
const DDF = 3.5 / DAY;                 // degree-day melt factor, mm w.e. per C per second
const RAIN_MELT = 4186 / 334000;       // mm of melt per mm of rain per C (water heat capacity / latent heat of fusion)
const SNOW_NEW_DENSITY = 100, SNOW_OLD_DENSITY = 380, TAU_SETTLE = 12 * DAY;   // kg/m3

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const logistic = (x) => 1 / (1 + Math.exp(-x));
const cloudTransmission = (c) => 1 - 0.75 * Math.pow(c, 3.4);         // Kasten and Czeplak (1980)
const directTransmission = (c) => Math.max(0, 1 - Math.pow(c, 1.5));   // the beam is cut far more than the sky
const lwFactor = (c) => 1 - 0.85 * c * c;                               // cloud returns long-wave to the ground
export const saturationVapourHPa = (T) => 6.112 * Math.exp((17.62 * T) / (243.12 + T));   // Magnus (WMO)
export function dewPointFrom(T, rh) {
  const g = Math.log(Math.max(rh, 1e-6)) + (17.62 * T) / (243.12 + T);
  return (243.12 * g) / (17.62 - g);
}
const snowFraction = (T) => clamp((2 - T) / 2, 0, 1);                   // all snow at 0 C, all rain at 2 C

// ---------------------------------------------------------------------------------------- climate model
// Everything derived from a climate and a latitude, computed once and cached (not simulation state:
// it is a pure function of the site, so it never needs saving).
const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
function normCdf(x) {   // Abramowitz and Stegun 26.2.17
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const p = normPdf(x) * k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
const meanExcess = (th) => normPdf(th) - th * (1 - normCdf(th));       // E[max(0, f - th)] for f ~ N(0, 1)
function thresholdFor(e) {
  let lo = -4, hi = 5;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (meanExcess(m) > e) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// Steady periodic response of a first-order lag (time constant tauDays) to a daily series.
function lagged(series, tauDays) {
  const k = 1 - Math.exp(-1 / tauDays), out = new Float64Array(series.length);
  let x = series.reduce((a, b) => a + b, 0) / series.length;
  for (let y = 0; y < 4; y++) for (let d = 0; d < series.length; d++) { x += (series[d] - x) * k; if (y === 3) out[d] = x; }
  return out;
}
const monthMean = (arr, m) => { let s = 0; for (let d = 0; d < MONTH_DAYS[m]; d++) s += arr[MONTH_START[m] + d]; return s / MONTH_DAYS[m]; };
// value of a monthly series at a day of year, linear between mid-months
function monthly(arr, doy, shift) {
  const mid = (m) => MONTH_START[m] + MONTH_DAYS[m] / 2;
  let m = 0; while (m < 11 && mid(m + 1) <= doy) m++;
  let a = m, b = m + 1, ta = mid(m), tb;
  if (doy < mid(0)) { a = 11; b = 0; ta = mid(11) - DAYS_IN_YEAR; }
  if (b > 11) b = 0;
  tb = b === 0 && a === 11 ? mid(0) + (doy < mid(0) ? 0 : DAYS_IN_YEAR) : mid(b);
  const w = (doy - ta) / (tb - ta);
  const v = (i) => arr[(i + shift) % 12];
  return v(a) + (v(b) - v(a)) * w;
}
const insolation = (lat) => Array.from({ length: DAYS_IN_YEAR }, (_, d) => dailyInsolationTOA(d, lat));

const fits = new Map();
function fitClimate(c) {
  if (fits.has(c.id)) return fits.get(c.id);
  const Q = insolation(c.latitudeDeg);
  let best = null;
  for (let tau = 8; tau <= 90; tau += 1) {
    const L = lagged(Q, tau), x = [], y = c.tempC;
    for (let m = 0; m < 12; m++) x.push(monthMean(L, m));
    const mx = x.reduce((a, b) => a + b) / 12, my = y.reduce((a, b) => a + b) / 12;
    let sxy = 0, sxx = 0; for (let m = 0; m < 12; m++) { sxy += (x[m] - mx) * (y[m] - my); sxx += (x[m] - mx) ** 2; }
    const b = sxy / sxx, a = my - b * mx;
    let sse = 0; for (let m = 0; m < 12; m++) sse += (a + b * x[m] - y[m]) ** 2;
    if (!best || sse < best.sse) best = { tauDays: tau, a, b, sse, rmsC: Math.sqrt(sse / 12) };
  }
  fits.set(c.id, best);
  return best;
}

const models = new Map();
export function climateModel(climateId, latitudeDeg) {
  const key = climateId + '@' + latitudeDeg;
  if (models.has(key)) return models.get(key);
  const c = CLIMATES[climateId] || CLIMATES[DEFAULT_CLIMATE];
  const fit = fitClimate(c);
  // monthly tables belong to the climate's hemisphere; south of the equator they shift by six months
  const shift = Math.sign(latitudeDeg || 1) === Math.sign(c.latitudeDeg) ? 0 : 6;
  const L = lagged(insolation(latitudeDeg), fit.tauDays);
  const seasonalC = new Float64Array(DAYS_IN_YEAR), offsetC = new Float64Array(DAYS_IN_YEAR), theta = new Float64Array(DAYS_IN_YEAR), lead = new Float64Array(DAYS_IN_YEAR);
  for (let d = 0; d < DAYS_IN_YEAR; d++) seasonalC[d] = fit.a + fit.b * L[d];
  const tMin = Math.min(...seasonalC), tMax = Math.max(...seasonalC);
  for (let d = 0; d < DAYS_IN_YEAR; d++) { const su = (seasonalC[d] - tMin) / Math.max(1e-6, tMax - tMin); lead[d] = CLOUD_LEAD_WINTER + (CLOUD_LEAD_SUMMER - CLOUD_LEAD_WINTER) * su; }
  const site = { latitudeDeg };
  // quadrature nodes for the cloud climatology: f and the cloud noise, both N(0, 1)
  const nodes = []; for (let i = -16; i <= 16; i++) { const x = i * 0.25; nodes.push([x, normPdf(x) * 0.25]); }
  const cnodes = []; for (let i = -4; i <= 4; i++) { const x = i * 0.6; cnodes.push([x, normPdf(x) * 0.6]); }
  for (let d = 0; d < DAYS_IN_YEAR; d++) {
    // precipitation: the threshold the frontal index must pass so the mean rate matches the normal
    const meanRate = monthly(c.precipMm.map((mm, m) => mm / (MONTH_DAYS[m] * 24)), d + 0.5, shift);
    theta[d] = thresholdFor(meanRate / c.rainRateMmH);
    // mean clear-sky global irradiance over this day
    let ghi = 0, lwd = 0; const t0 = (d - START_DAY_OF_YEAR) * DAY;
    for (let h = 0; h < 48; h++) { const g = clearSkyIrradiance(t0 + (h + 0.5) * 1800, site).globalHorizontalWm2; ghi += g / 48; lwd += lwDepth(g) / 48; }
    // climatological means of the cloud factors (cloud follows f relative to this day's threshold)
    let et = 0, el = 0, w = 0;
    for (const [f, pf] of nodes) for (const [n, pn] of cnodes) {
      const cl = logistic(CLOUD_SLOPE * (f - theta[d] + lead[d]) + CLOUD_NOISE * n), p = pf * pn;
      et += p * cloudTransmission(cl); el += p * lwFactor(cl); w += p;
    }
    // the boundary layer's mean departure from the air mass under average sky: removed so that the
    // monthly means of the simulated temperature land on the climate's normals
    offsetC[d] = c.boundaryLayerHours * HOUR * (K_SOLAR * ghi * et / w - LW_CLEAR * lwd * el / w);
  }
  // deep soil: the same lag applied to the seasonal temperature, for a new world's starting value
  const soilC = lagged(Array.from(seasonalC), TAU_SOIL / DAY);
  const m = { climate: c, fit, shift, seasonalC, offsetC, theta, lead, soilC, tMin, tMax };
  models.set(key, m);
  return m;
}
const atDay = (arr, x) => { const i = Math.floor(x), f = x - i; return arr[i % DAYS_IN_YEAR] * (1 - f) + arr[(i + 1) % DAYS_IN_YEAR] * f; };

// ---------------------------------------------------------------------------------------- the system
function freshState(site, t, rng) {
  const s = {
    site: { latitudeDeg: site.latitudeDeg, climate: site.climate },
    tempC: 0, humidity: 0.7, dewPointC: 0, windMs: 0, windDirRad: 0, cloud: 0.5, rainMmH: 0, snowMmH: 0, snowDepthM: 0,
    pressureHPa: P_MEAN, solar: { directNormalWm2: 0, diffuseWm2: 0, globalHorizontalWm2: 0 }, groundTempC: 0,
    // internal generator state
    v: STATE_V,
    gen: { g: rng.normal(), f: 0, airmass: rng.normal(), cloudNoise: rng.normal(), dirNoise: 0, gust: 0, blC: 0 },
    snowSweMm: 0, snowDensityKgM3: SNOW_NEW_DENSITY,
    totals: { precipMm: 0, snowfallMm: 0, meltMm: 0 },   // running sums since the world began, for the ledger and tests
  };
  s.gen.f = s.gen.g * 0.8;
  const M = climateModel(s.site.climate, s.site.latitudeDeg), x = dayOfYear(t) + dayFraction(t);
  s.gen.blC = atDay(M.offsetC, x);
  s.groundTempC = atDay(M.soilC, x);
  s.cloud = logistic(CLOUD_SLOPE * (s.gen.f * F_SCALE - atDay(M.theta, x) + atDay(M.lead, x)));
  diagnose(s, t, M, 0);
  return s;
}
function defaultSite() { return { latitudeDeg: CLIMATES[DEFAULT_CLIMATE].latitudeDeg, climate: DEFAULT_CLIMATE }; }

// Everything that follows from the generator state at time t without advancing it.
function diagnose(s, t, M, precip) {
  const G = s.gen, x = dayOfYear(t) + dayFraction(t), c = M.climate;
  const summer = clamp((atDay(M.seasonalC, x) - M.tMin) / Math.max(1e-6, M.tMax - M.tMin), 0, 1);
  const f = G.f * F_SCALE, trend = clamp((G.g - G.f) * TREND_SCALE, -4, 4);
  const sd = c.anomalySdC[0] + (c.anomalySdC[1] - c.anomalySdC[0]) * summer;
  const airC = atDay(M.seasonalC, x) + sd * G.airmass + 1.5 * Math.tanh(trend);   // warm ahead of a front, cold behind
  // sandboxC: a sandbox shift of the air (the debug menu's "winter now"); absent in a normal game
  s.tempC = airC + G.blC - atDay(M.offsetC, x) + (s.sandboxC || 0);
  // humidity: the air mass carries a dew point; moist in fronts and rain, dry under clear high pressure
  let dep = (c.dewDepressionC[0] + (c.dewDepressionC[1] - c.dewDepressionC[0]) * summer) * (1.6 - 1.3 * s.cloud);
  let td = airC - Math.max(0.2, dep);
  if (precip > 0) td = Math.max(td, s.tempC - 0.4 - 1.2 / (1 + 4 * precip));   // falling rain moistens the air toward saturation
  s.dewPointC = Math.min(td, s.tempC);
  s.humidity = clamp(saturationVapourHPa(s.dewPointC) / saturationVapourHPa(s.tempC), 0, 1);
  s.pressureHPa = P_MEAN - P_PER_F * f;
  // wind: strong in deep lows, light under high pressure, mixed down by daytime heating, calmer at night
  const mix = 0.75 + 0.5 * clamp(s.solar.globalHorizontalWm2 / 500, 0, 1);
  const synoptic = Math.max(0.25, 0.75 + 0.45 * f + 0.08 * f * f) / 0.78;     // about 1 on average, day and night together
  s.windMs = c.windMs * synoptic * mix * Math.exp(0.12 * G.gust - 0.007);
  const dirDeg = c.prevailingFromDeg - 70 * Math.tanh(1.2 * trend) + 25 * G.dirNoise;
  s.windDirRad = ((((dirDeg % 360) + 360) % 360) * Math.PI) / 180;
}

function step(ctx) {
  let s = ctx.s;
  if (!s || s.v !== STATE_V) { ctx.s = s = freshState((s && s.site) || defaultSite(), ctx.t, ctx.rng()); return; }
  // t carries the date from the seasonal clock and the hour from the clock (ctx.ct), so a shortened
  // year compresses the seasons while each day's weather still runs hour by hour
  const dt = ctx.dt, t = (ctx.ct === undefined ? ctx.t : ctx.ct) + dt / 2, G = s.gen, rng = ctx.rng();
  const M = climateModel(s.site.climate, s.site.latitudeDeg), c = M.climate;
  const x = dayOfYear(t) + dayFraction(t);
  // weather systems
  const rg = Math.exp(-dt / TAU_G);
  G.g = G.g * rg + Math.sqrt(1 - rg * rg) * rng.normal();
  G.f += (G.g - G.f) * (1 - Math.exp(-dt / TAU_L));
  const ra = Math.exp(-dt / TAU_AIRMASS); G.airmass = G.airmass * ra + Math.sqrt(1 - ra * ra) * rng.normal();
  const rc = Math.exp(-dt / TAU_CLOUDNOISE); G.cloudNoise = G.cloudNoise * rc + Math.sqrt(1 - rc * rc) * rng.normal();
  const rd = Math.exp(-dt / TAU_WINDDIR); G.dirNoise = G.dirNoise * rd + Math.sqrt(1 - rd * rd) * rng.normal();
  const ru = Math.exp(-dt / TAU_GUST); G.gust = G.gust * ru + Math.sqrt(1 - ru * ru) * rng.normal();
  const f = G.f * F_SCALE, theta = atDay(M.theta, x);
  // cloud
  const target = logistic(CLOUD_SLOPE * (f - theta + atDay(M.lead, x)) + CLOUD_NOISE * G.cloudNoise);
  s.cloud += (target - s.cloud) * (1 - Math.exp(-dt / TAU_CLOUD));
  // sunlight on the ground under this cloud
  const clear = clearSkyIrradiance(t, s.site);
  const cosZ = clear.directNormalWm2 > 0 ? (clear.globalHorizontalWm2 - clear.diffuseWm2) / clear.directNormalWm2 : 0;
  const ghi = clear.globalHorizontalWm2 * cloudTransmission(s.cloud);
  const dni = clear.directNormalWm2 * directTransmission(s.cloud);
  s.solar = { directNormalWm2: dni, diffuseWm2: Math.max(0, ghi - dni * cosZ), globalHorizontalWm2: ghi };
  // boundary layer heat balance (exact exponential update over the step)
  const snowCover = clamp(s.snowDepthM / 0.05, 0, 1);
  const forcing = K_SOLAR * ghi * (1 - 0.6 * snowCover) - LW_CLEAR * lwDepth(clear.globalHorizontalWm2) * lwFactor(s.cloud);
  const tauBL = c.boundaryLayerHours * HOUR, rb = Math.exp(-dt / tauBL);   // relaxation toward the air mass
  G.blC = G.blC * rb + tauBL * forcing * (1 - rb);
  // precipitation: only from a deep enough system under thick cloud
  const P = c.rainRateMmH * Math.max(0, f - theta) * smooth(0.55, 0.8, s.cloud);
  diagnose(s, t, M, P);
  const sf = snowFraction(s.tempC);
  s.snowMmH = P * sf; s.rainMmH = P * (1 - sf);
  // snowpack: accumulate, settle, melt (degree days plus the heat in rain)
  const hours = dt / HOUR, fall = s.snowMmH * hours;
  if (fall > 0) {
    s.snowDensityKgM3 = (s.snowDensityKgM3 * s.snowSweMm + SNOW_NEW_DENSITY * fall) / (s.snowSweMm + fall);
    s.snowSweMm += fall;
  }
  let melt = 0;
  if (s.snowSweMm > 0 && s.tempC > 0) melt = Math.min(s.snowSweMm, DDF * s.tempC * dt + RAIN_MELT * s.rainMmH * hours * s.tempC);
  s.snowSweMm -= melt;
  if (s.snowSweMm < 1e-3) { s.snowSweMm = 0; s.snowDensityKgM3 = SNOW_NEW_DENSITY; }
  else s.snowDensityKgM3 += (SNOW_OLD_DENSITY - s.snowDensityKgM3) * (1 - Math.exp(-dt / TAU_SETTLE));
  s.snowDepthM = s.snowSweMm / s.snowDensityKgM3;
  // deep soil, insulated by snow
  const insul = clamp(s.snowDepthM / 0.3, 0, 1), airForSoil = s.tempC + (Math.max(s.tempC, 0) - s.tempC) * insul;
  s.groundTempC += (airForSoil - s.groundTempC) * (1 - Math.exp(-(ctx.lifeDt === undefined ? dt : ctx.lifeDt) / TAU_SOIL));   // the soil follows the seasons, so it runs on the seasonal clock
  s.totals.precipMm += P * hours; s.totals.snowfallMm += fall; s.totals.meltMm += melt;
}

function setSite(ctx, p = {}) {
  const s = ctx.s, climate = p.climate !== undefined ? p.climate : s.site.climate;
  if (!CLIMATES[climate]) throw new Error('unknown climate: ' + climate);
  let lat = p.latitudeDeg !== undefined ? +p.latitudeDeg : p.climate !== undefined ? CLIMATES[climate].latitudeDeg : s.site.latitudeDeg;
  if (!Number.isFinite(lat)) throw new Error('latitude must be a number');
  lat = clamp(lat, -66, 66);           // the sun model and the climate fits are for the non-polar world
  s.site = { latitudeDeg: lat, climate };
}

// sandbox: shift the air temperature by c degrees (0 clears it). Saved with the game, so a forced winter survives a reload.
function debugShift(ctx, p = {}) {
  const c = clamp(+p.c || 0, -40, 40);
  ctx.s.tempC += c - (ctx.s.sandboxC || 0);        // felt at once, not at the next weather step
  if (c) ctx.s.sandboxC = c; else delete ctx.s.sandboxC;
  return { ok: true, c };
}

export const weather = {
  name: 'weather',
  every: EVERY,
  init: (ctx) => freshState(defaultSite(), ctx.t, ctx.rng()),
  step,
  commands: { 'weather.setSite': setSite, 'weather.debugShift': debugShift },
};

// Short condition word for readouts (src/weather-view.js uses the same rule).
export function conditionWord(w) {
  if (w.snowMmH > 0.05 && w.snowMmH >= w.rainMmH) return 'Snow';
  if (w.rainMmH > 0.05) return 'Rain';
  if (w.windMs > 8) return 'Windy';
  if (w.cloud > 0.6) return 'Cloudy';
  return 'Clear';
}
