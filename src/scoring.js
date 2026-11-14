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
  const cdText = Number.isFinite(cd) ? cd.toFixed(2) : '—';
  const wake =
    c < 0.7
      ? `A drag coefficient of ${cdText} is low. The air follows the body all the way round and rejoins cleanly behind it, so pressure recovers along the back and the wake is thin. This is what a tail or a rounded rear buys you.`
      : c < 1.4
        ? `A drag coefficient of ${cdText} is middling. The front is doing fine, but the air lets go at the blunt parts and leaves a low-pressure pocket behind that pulls the body backward. Shedding vortices from that pocket are why the number wobbles. A tail or rounder corners would shrink it.`
        : `A drag coefficient of ${cdText} is high. To the air this shape is nearly a wall: the flow separates at the front edges and a wide, churning wake forms behind it. Almost all of the drag is that wake. Taper the back or round the front to change it.`;
  const clText = Number.isFinite(cl) ? Math.abs(cl).toFixed(2) : '—';
  const force =
    Math.abs(cl) < 0.12
      ? `Lift is about zero, so the air leaves at the same height it arrived. Tilt the shape a few degrees or curve its top to deflect the air downward, and the shape gets pushed up in return.`
      : cl > 0
        ? `A lift coefficient of ${clText} means the shape is bending the air downward, and by Newton's third law the air pushes the shape up. The pressure on top is lower than underneath.`
        : `A lift coefficient of −${clText} means the air is being deflected upward, so the shape is pushed down. Racing cars want exactly this. Flip the tilt to turn it into lift.`;
  return `${wake} ${force}`;
}

export function regimeSentence(re) {
  const n = Math.round(re);
  if (re < 180) {
    return `Reynolds number ${n} is low. That number compares the air's momentum with its stickiness, and here stickiness wins: the air behaves like syrup, clings to the surface, and closes up behind the body with no vortices at all.`;
  }
  if (re < 1200) {
    return `Reynolds number ${n} is moderate. Momentum and stickiness are roughly matched, so the air follows the front of the body but lets go behind it and sheds vortices in a steady rhythm, first from one side, then the other.`;
  }
  return `Reynolds number ${n} is high. Momentum dominates and the air cannot follow the curves, so the wake breaks into chaotic turbulence. Raise the viscosity slider to watch it calm back down.`;
}
