// Driving keys, generic: a keyboard (or a pad) read the way a car is driven, not "push where you want to go on screen".
// The mapping only: it makes { throttle, steer, brake, handbrake } for the unchanged drive model (vehicles-drive.js), so the
// gearbox, grip and load-dependent steering do the rest. Sibling of headingControl, which stays for touch sticks and as
// a setting (localStorage.driveScheme = 'heading').
//
//   carControl(b, kind, st, { fwd, turn, brake, gentle }, dt)
//     fwd    -1..1  W = +1 (throttle), S = -1 (the brake, full; stopped and still held CAR_REVERSE_HOLD_S, reverse)
//     turn   -1..1  A = -1 (the rider's left), D = +1 (the rider's right), relative to the vehicle, never the camera. The
//                   drive model's steer is the other way round: its positive steer turns toward R = the body's local +x,
//                   which in the engine's y-up world is the rider's LEFT (a rider facing +z has -x at the right hand; the
//                   chase camera behind sees -R on the right of the screen). So D is negative steer. The drive model eases
//                   the front wheels toward it at the record's steerRate and back to centre when it is 0. Reversing turns
//                   the front wheels the same way (the tail swings the other way), as in a real car. A tracked machine
//                   reads the same axis as its differential (D turns right, pivoting when stopped).
//     brake  bool   the brake pedal / Space; gentle bool  Shift: throttle capped to a gentle share
//   st: { thr, steer } per-driver scratch (the analogue throttle pedal, the bars), start with {}.
// Light rider habits for a wheeled machine, so ordinary keys do not spin it (the physics is untouched):
//   - the bars: A/D turn them at a rate that falls with speed (full lock in about 0.15 s at a walk, the useful angle at
//     speed as quickly, a whole lock-to-lock sweep in about half a second at top speed) and back to centre as fast;
//   - a hill start: W from a stop on a slope, the rider holds the brake while feeding in throttle and lets it go once the
//     pedal is most of the way in, so the quad does not roll back first (the old rule braked whenever it rolled back
//     at all with W held, so on 20 degrees and more it sat braking against its own rollback and never climbed);
//   - through a turn: letting go of W while the bars are turned and it is still moving keeps a whisper of throttle
//     (CAR_TURN_HOLD) instead of the full engine braking of the automatic, as riders are taught to hold a steady
//     throttle through a turn. Engine braking mid-turn on the solid rear axle, already at its grip, lets the tail go and
//     an unbraked trailer push the rig round; S or Space still brake.
import { gripSteer, steerLimit } from './vehicles-drive.js';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const CAR_STOPPED_MPS = 0.5;     // below this a held S counts as stopped: it keeps braking, and reverses once held
export const CAR_REVERSE_HOLD_S = 0.3;  // that long (a tap of S at a standstill only holds the brake)
export const CAR_GENTLE = 0.35;
export const CAR_RAMP_UP = 1.6;         // pedal travel per second while held (full throttle in about 0.6 s)
export const CAR_RAMP_DOWN = 4;         // and back off the pedal
export const CAR_STEER_RATE = 3;       // bar travel (fraction of lock) per second is CAR_STEER_RATE / (0.25 + speed / topMps)
export const CAR_BARS_MIN = 0.2;
export const CAR_TOW_K = 0.5;           // towing, the rider asks the tyres for less: grip x mass / (mass + CAR_TOW_K x towed mass)        // a held key never asks less than this share of the lock
export const CAR_BACKING_MPS = 1.5;     // W while backing faster than this brakes to a stop first; slower, it is a hill start
export const CAR_HILL_PEDAL = 0.8;      // a hill start: rolling back with W held, the brake holds it until the pedal is this far in
export const CAR_TURN_HOLD = 0.08;      // the throttle kept through a turn when W is let go
export const CAR_TURN_HOLD_MPS = 1.5;   // above this speed, with the bars turned past CAR_TURN_HOLD_STEER
export const CAR_TURN_HOLD_STEER = 0.3;
export function carControl(b, kind, st, { fwd = 0, turn = 0, brake = false, gentle = false } = {}, dt = 1 / 60) {
  const cap = gentle ? CAR_GENTLE : 1;
  const want = brake ? 0 : clamp(fwd, -1, 1);
  const rate = (Math.abs(want) > Math.abs(st.thr || 0) ? CAR_RAMP_UP : CAR_RAMP_DOWN) * dt;
  // the pedal: W ramps up from where it is; changing between W and S lets go first (the sign flips through zero)
  let tgt = want * cap;
  if (tgt * (st.thr || 0) < 0) tgt = 0;
  st.thr = (st.thr || 0) + clamp(tgt - (st.thr || 0), -rate, rate);
  let steer = -clamp(turn, -1, 1);                                    // D (+1) is the rider's right: toward -R
  const wheeled = kind.drive !== 'tracked';
  let bars = 1;
  if (wheeled) {
    // a held key at speed is the bars turned as far as the tyres can use (gripSteer), not to the stop: past it the
    // front only plows and the turn gets wider
    const m = kind.massKg + (b.cargoKg || 0), tow = b.towKg > 0 ? m / (m + CAR_TOW_K * b.towKg) : 1;
    bars = clamp(gripSteer(kind, b.u, (b.mu || kind.grip.mu) * tow) / Math.max(steerLimit(kind, b.u), 0.05), CAR_BARS_MIN, 1);
    const r = (CAR_STEER_RATE / (0.25 + Math.min(1, Math.abs(b.u) / (kind.topMps || 1)))) * dt, s0 = st.steer || 0;
    steer = st.steer = s0 + clamp(steer * bars - s0, -r, r);
  }
  const out = { throttle: 0, steer, brake: 0, handbrake: false };
  if (brake) { b.rev = false; out.brake = 1; return out; }
  if (want > 0) {                                                      // W: forward; if still rolling back, brake to a stop first
    b.rev = false;
    if (b.u < -CAR_BACKING_MPS) { out.brake = want; st.thr = 0; }
    else if (b.u < 0 && st.thr < CAR_HILL_PEDAL * cap) { out.brake = 1; out.throttle = st.thr; }   // a hill start (see above)
    else out.throttle = st.thr;
  } else if (want < 0) {                                               // S: brake to a stop; held there, reverse
    if (!b.rev && b.u < -CAR_STOPPED_MPS) b.rev = true;               // already rolling back: keep backing
    if (!b.rev) {
      out.brake = 1; st.thr = 0;
      st.revT = b.u > CAR_STOPPED_MPS ? 0 : (st.revT || 0) + dt;
      if (st.revT >= CAR_REVERSE_HOLD_S) b.rev = true;
    }
    if (b.rev) { out.brake = 0; out.throttle = st.thr; }
  } else {                                                             // no pedal: engine braking coasts down; hold the brake once nearly stopped
    b.rev = false;
    out.throttle = st.thr;
    out.brake = Math.abs(b.u) < (kind.engine ? 1.2 : 0.4) ? 1 : kind.engine ? 0 : 0.15;
    if (wheeled && kind.engine && b.u > CAR_TURN_HOLD_MPS && Math.abs(steer) > CAR_TURN_HOLD_STEER * bars) { out.throttle = Math.max(out.throttle, CAR_TURN_HOLD); out.brake = 0; }
  }
  return out;
}
