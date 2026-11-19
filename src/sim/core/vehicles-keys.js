// Driving keys, generic: a keyboard (or a pad) read the way a car is driven, not "push where you want to go on screen".
// The mapping only: it makes { throttle, steer, brake, handbrake } for the unchanged drive model (vehicles-drive.js), so the
// gearbox, grip and load-dependent steering do the rest. Sibling of headingControl, which stays for touch sticks and as
// a setting (localStorage.driveScheme = 'heading').
//
//   carControl(b, kind, st, { fwd, turn, brake, gentle }, dt)
//     fwd    -1..1  W = +1 (throttle), S = -1 (brake; once nearly stopped and still held, reverse)
//     turn   -1..1  A = -1 (left), D = +1 (right), relative to the vehicle, never the camera. The drive model eases the front
//                   wheels toward it at the record's steerRate and back to centre when it is 0. Reversing turns the front
//                   wheels the same way (the tail swings the other way), as in a real car. A tracked machine reads the
//                   same axis as its differential (D turns right, pivoting when stopped).
//     brake  bool   the brake pedal / Space; gentle bool  Shift: throttle capped to a gentle share
//   st: { thr } per-driver scratch (the analogue throttle pedal), start with {}.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const CAR_STOPPED_MPS = 0.5;     // below this a held S stops braking and starts reversing
export const CAR_GENTLE = 0.35;
export const CAR_RAMP_UP = 1.6;         // pedal travel per second while held (full throttle in about 0.6 s)
export const CAR_RAMP_DOWN = 4;         // and back off the pedal
export function carControl(b, kind, st, { fwd = 0, turn = 0, brake = false, gentle = false } = {}, dt = 1 / 60) {
  const cap = gentle ? CAR_GENTLE : 1;
  const want = brake ? 0 : clamp(fwd, -1, 1);
  const rate = (Math.abs(want) > Math.abs(st.thr || 0) ? CAR_RAMP_UP : CAR_RAMP_DOWN) * dt;
  // the pedal: W ramps up from where it is; changing between W and S lets go first (the sign flips through zero)
  let tgt = want * cap;
  if (tgt * (st.thr || 0) < 0) tgt = 0;
  st.thr = (st.thr || 0) + clamp(tgt - (st.thr || 0), -rate, rate);
  const steer = clamp(turn, -1, 1);
  const out = { throttle: 0, steer, brake: 0, handbrake: false };
  if (brake) { b.rev = false; out.brake = 1; return out; }
  if (want > 0) {                                                      // W: forward; if still rolling back, brake to a stop first
    b.rev = false;
    if (b.u < -CAR_STOPPED_MPS) { out.brake = want; st.thr = 0; } else out.throttle = st.thr;
  } else if (want < 0) {                                               // S: brake while rolling forward, then reverse while held
    if (b.u > CAR_STOPPED_MPS && !b.rev) { out.brake = -want; st.thr = 0; } else { b.rev = true; out.throttle = st.thr; }
  } else {                                                             // no pedal: engine braking coasts down; hold the brake once nearly stopped
    b.rev = false;
    out.throttle = st.thr;
    out.brake = Math.abs(b.u) < (kind.engine ? 1.2 : 0.4) ? 1 : kind.engine ? 0 : 0.15;
  }
  return out;
}
