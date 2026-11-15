// Simulation time. One unit of sim time is one second of the homestead's world.
// The calendar (months, seasons, sun) is layered on top of this in the weather iteration.

export const TICK = 60;                 // seconds of world time per simulation tick
export const DAY = 86400;
export const HOUR = 3600;
export const START_T = 8 * HOUR + 600;  // a new world begins at 08:10 on day 1

export const dayFraction = (t) => (((t % DAY) + DAY) % DAY) / DAY;   // 0 = midnight, 0.5 = noon
export const dayIndex = (t) => Math.floor(t / DAY);                  // 0-based
export const hourOfDay = (t) => dayFraction(t) * 24;
export function clockText(t) {
  const m = Math.floor(dayFraction(t) * 1440 + 1e-6);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
