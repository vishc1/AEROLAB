/**
 * Shared scoring rules. Used by the browser AND the leaderboard server, so a
 * client can never submit a made-up score: the server recomputes it from Cd/Cl.
 *
 * 2D and 3D are scored on separate scales because the coarse 3D lattice
 * inflates Cd (low lattice Re, ~1 voxel thick wings), so the two boards are
 * never mixed.
 */
const SLOPE = { '2D': 24, '3D': 9 };

export function normaliseDim(dim) {
  return String(dim).toUpperCase() === '3D' ? '3D' : '2D';
}

/** 0–100. Lower drag wins; useful lift earns up to 8 bonus points. */
export function efficiency(cd, cl, dim = '2D') {
  if (!Number.isFinite(cd) || !Number.isFinite(cl)) return 0;
  const slope = SLOPE[normaliseDim(dim)];
  return Math.max(0, Math.min(100, 100 - Math.max(0, cd) * slope + Math.min(8, Math.abs(cl) * 3)));
}

/** Lift-to-drag ratio: the second ranking. */
export function liftToDrag(cd, cl) {
  return Math.abs(cd) > 0.001 ? cl / cd : 0;
}

export function explain(cd, cl, dim = '2D') {
  const scale = normaliseDim(dim) === '3D' ? 4 : 1;
  const c = cd / scale;
  const wake =
    c < 0.7
      ? 'The narrow wake suggests the air is rejoining cleanly behind your shape.'
      : c < 1.4
        ? 'The wake is controlled, but the blunt regions are still shedding visible vortices.'
        : 'A broad, turbulent wake is carrying momentum away from the object.';
  const force =
    Math.abs(cl) < 0.12
      ? 'It is nearly lift-neutral; tilt or curve a surface to redirect more air.'
      : cl > 0
        ? 'The pressure imbalance is producing useful upward lift.'
        : 'The current angle is producing downforce; flip the tilt to reverse it.';
  return `${wake} ${force}`;
}

export function regimeSentence(re) {
  if (re < 180) return 'Re is low, so viscosity wins: air hugs the surface and the flow stays smooth and steady.';
  if (re < 1200) return 'Re is moderate, so inertia and viscosity are balanced: expect vortices peeling off in a rhythm.';
  return 'Re is high, so inertia dominates: the wake breaks into chaotic, turbulent swirls.';
}
