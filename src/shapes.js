/**
 * Shape library for "describe and race".
 *
 * Every shape is a closed polygon in a unit box: x runs 0..1 left to right
 * with the wind arriving from the left, y runs 0..1 top to bottom. The library
 * answers common descriptions instantly and offline; anything it does not
 * know is sent to the Claude endpoint in api/shapes.js.
 */

const TAU = Math.PI * 2;

function profile(halfWidth, steps = 40, x0 = 0, x1 = 1) {
  // Builds a symmetric body from a half-width function w(t), t in 0..1.
  const top = [];
  const bottom = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const w = Math.max(0, halfWidth(t));
    top.push([x, 0.5 - w]);
    bottom.push([x, 0.5 + w]);
  }
  return [...top, ...bottom.reverse()];
}

function normalise(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  // Uniform scale so proportions survive; the short axis is centred.
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  const s = Math.max(sx, sy);
  const ox = (1 - sx / s) / 2;
  const oy = (1 - sy / s) / 2;
  return points.map(([x, y]) => [(x - minX) / s + ox, (y - minY) / s + oy]);
}

function ellipse(aspect, steps = 48) {
  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * TAU;
    out.push([0.5 + 0.5 * Math.cos(a), 0.5 + (0.5 / aspect) * Math.sin(a)]);
  }
  return normalise(out);
}

function rect(aspect, radius = 0.04) {
  const h = 1 / aspect;
  const r = Math.min(radius, h / 2);
  const out = [];
  const corner = (cx, cy, from) => {
    for (let i = 0; i <= 6; i += 1) {
      const a = from + (i / 6) * (Math.PI / 2);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(1 - r, r, -Math.PI / 2);
  corner(1 - r, h - r, 0);
  corner(r, h - r, Math.PI / 2);
  corner(r, r, Math.PI);
  return normalise(out);
}

const teardrop = () => normalise(profile((t) => Math.sqrt(t) * Math.pow(1 - t, 1.15) * 0.44));
const egg = () => normalise(profile((t) => Math.sqrt(t * (1 - t)) * (1.08 - 0.35 * t) * 0.78));
const bullet = () =>
  normalise(profile((t) => (t < 0.38 ? Math.sqrt(1 - ((0.38 - t) / 0.38) ** 2) : 1) * 0.5));
const cone = () => [[0, 0.5], [1, 0.12], [1, 0.88]];
const dome = () => {
  const out = [];
  for (let i = 0; i <= 28; i += 1) {
    const a = Math.PI / 2 + (i / 28) * Math.PI;
    out.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  return normalise(out);
};
const cup = () => {
  // Open side faces the wind: a parachute, bowl or umbrella caught backwards.
  const out = [];
  for (let i = 0; i <= 24; i += 1) {
    const a = -Math.PI / 2 + (i / 24) * Math.PI;
    out.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  for (let i = 24; i >= 0; i -= 1) {
    const a = -Math.PI / 2 + (i / 24) * Math.PI;
    out.push([0.5 + 0.34 * Math.cos(a), 0.5 + 0.34 * Math.sin(a)]);
  }
  return normalise(out);
};
const fish = () => {
  const body = profile((t) => Math.sqrt(t) * Math.pow(1 - t, 1.2) * 0.6, 32, 0, 0.74);
  const n = body.length / 2;
  const top = body.slice(0, n);
  const bottom = body.slice(n);
  return normalise([...top, [0.78, 0.47], [1, 0.22], [0.93, 0.5], [1, 0.78], [0.78, 0.53], ...bottom]);
};
const rocket = () =>
  normalise([
    [0, 0.5], [0.3, 0.3], [0.78, 0.3], [0.86, 0.08], [1, 0.08], [0.96, 0.3], [0.96, 0.7], [1, 0.92], [0.86, 0.92],
    [0.78, 0.7], [0.3, 0.7],
  ]);
const pencil = () => normalise([[0, 0.5], [0.12, 0.42], [1, 0.42], [1, 0.58], [0.12, 0.58]]);
const bus = () =>
  normalise([
    [0.02, 0.9], [0, 0.4], [0.04, 0.2], [0.1, 0.12], [0.96, 0.1], [1, 0.2], [1, 0.9], [0.9, 0.92], [0.86, 1],
    [0.78, 1], [0.74, 0.92], [0.26, 0.92], [0.22, 1], [0.14, 1], [0.1, 0.92],
  ]);
const truck = () =>
  normalise([
    [0, 0.92], [0, 0.42], [0.06, 0.26], [0.2, 0.22], [0.24, 0.42], [0.3, 0.42], [0.3, 0.06], [1, 0.06], [1, 0.9],
    [0.92, 0.92], [0.88, 1], [0.8, 1], [0.76, 0.92], [0.2, 0.92], [0.16, 1], [0.08, 1], [0.04, 0.92],
  ]);
const car = () =>
  normalise([
    [0, 0.86], [0, 0.58], [0.06, 0.46], [0.24, 0.42], [0.36, 0.4], [0.44, 0.12], [0.64, 0.1], [0.74, 0.14],
    [0.86, 0.4], [1, 0.48], [1, 0.86], [0.88, 0.88], [0.84, 1], [0.72, 1], [0.68, 0.88], [0.32, 0.88], [0.28, 1],
    [0.16, 1], [0.12, 0.88],
  ]);
const sportsCar = () =>
  normalise([
    [0, 0.9], [0, 0.66], [0.08, 0.5], [0.32, 0.44], [0.46, 0.2], [0.62, 0.18], [0.78, 0.26], [0.9, 0.46], [1, 0.54],
    [1, 0.9], [0.88, 0.9], [0.84, 1], [0.72, 1], [0.68, 0.9], [0.32, 0.9], [0.28, 1], [0.16, 1], [0.12, 0.9],
  ]);
const train = () =>
  normalise([[0, 0.55], [0.08, 0.3], [0.3, 0.16], [1, 0.16], [1, 1], [0.1, 1], [0, 0.85]]);
const leaf = () => {
  const pts = ellipse(4.2);
  const a = (-8 * Math.PI) / 180;
  return normalise(pts.map(([x, y]) => [x * Math.cos(a) - (y - 0.5) * Math.sin(a), x * Math.sin(a) + (y - 0.5) * Math.cos(a)]));
};
const person = () =>
  normalise([
    [0.3, 0.14], [0.36, 0.02], [0.56, 0], [0.66, 0.1], [0.62, 0.22], [0.92, 0.3], [1, 0.42], [0.98, 0.62], [0.8, 0.6],
    [0.8, 1], [0.6, 1], [0.52, 0.72], [0.44, 1], [0.24, 1], [0.24, 0.6], [0.06, 0.62], [0, 0.44], [0.1, 0.3],
  ]);
const hand = () =>
  normalise([
    [0.14, 0.42], [0.02, 0.5], [0.08, 0.6], [0.3, 0.6], [0.3, 1], [0.8, 1], [0.9, 0.52], [0.98, 0.22], [0.9, 0.18],
    [0.84, 0.36], [0.82, 0.06], [0.72, 0.04], [0.68, 0.34], [0.66, 0.02], [0.56, 0], [0.52, 0.34], [0.5, 0.06],
    [0.4, 0.06], [0.38, 0.4], [0.3, 0.42],
  ]);
const bottle = () =>
  normalise([[0, 0.42], [0.2, 0.42], [0.3, 0.2], [0.42, 0.1], [1, 0.1], [1, 0.9], [0.42, 0.9], [0.3, 0.8], [0.2, 0.58], [0, 0.58]]);
const bird = () => {
  const body = profile((t) => Math.sqrt(t) * Math.pow(1 - t, 1.3) * 0.5, 28, 0, 0.8);
  const n = body.length / 2;
  return normalise([...body.slice(0, n), [0.84, 0.46], [1, 0.4], [1, 0.6], [0.84, 0.54], ...body.slice(n)]);
};
const naca = () => {
  const out = [];
  const th = (x) => 0.12 * 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  for (let i = 0; i <= 40; i += 1) out.push([i / 40, 0.5 - th(i / 40)]);
  for (let i = 40; i >= 0; i -= 1) out.push([i / 40, 0.5 + th(i / 40)]);
  const a = (4 * Math.PI) / 180;
  return normalise(out.map(([x, y]) => [x * Math.cos(a) - (y - 0.5) * Math.sin(a), x * Math.sin(a) + (y - 0.5) * Math.cos(a)]));
};

export const SHAPES = [
  { id: 'teardrop', label: 'Teardrop', aliases: ['teardrop', 'tear drop', 'raindrop', 'rain drop', 'drop', 'streamlined body', 'streamline'], build: teardrop,
    why: 'Round nose, long tapering tail. The air stays attached and pressure recovers along the tail, so the wake is tiny.' },
  { id: 'brick', label: 'Brick', aliases: ['brick', 'box', 'block', 'crate', 'rectangle', 'cuboid', 'suitcase', 'fridge', 'shipping container', 'container'], build: () => rect(1.7, 0.03),
    why: 'Sharp corners force the flow to separate immediately. A wide, low-pressure wake drags behind it.' },
  { id: 'cube', label: 'Cube', aliases: ['cube', 'square', 'dice', 'die'], build: () => rect(1, 0.03),
    why: 'Same story as the brick: separation at the front corners and a wake as tall as the body.' },
  { id: 'ball', label: 'Ball', aliases: ['ball', 'sphere', 'circle', 'cylinder', 'round', 'orange', 'football', 'basketball', 'tennis ball', 'globe', 'marble', 'pipe', 'pole', 'cable', 'wire'], build: () => ellipse(1),
    why: 'Smooth, but blunt at the back. The flow separates just past the widest point and sheds vortices alternately.' },
  { id: 'egg', label: 'Egg', aliases: ['egg', 'oval', 'ellipse', 'avocado', 'blimp', 'airship', 'zeppelin', 'balloon'], build: egg,
    why: 'A fatter nose and gentler tail than a ball, so separation happens later and the wake is narrower.' },
  { id: 'wing', label: 'Wing', aliases: ['wing', 'airfoil', 'aerofoil', 'aircraft wing', 'glider', 'plane wing', 'foil'], build: naca,
    why: 'Thin, rounded nose, sharp trailing edge, a few degrees of tilt. Very little wake, and it turns the air down for lift.' },
  { id: 'plate', label: 'Flat plate', aliases: ['flat plate', 'plate', 'wall', 'door', 'sign', 'billboard', 'board', 'sheet', 'barn door'], build: () => rect(0.09, 0.01),
    why: 'Face-on to the wind, everything separates at the edges. This is close to the worst shape there is.' },
  { id: 'bullet', label: 'Bullet', aliases: ['bullet', 'capsule', 'pill', 'submarine', 'torpedo', 'missile', 'fuselage', 'bullet train nose'], build: bullet,
    why: 'Smooth ogive nose but a flat base. The front is clean; the blunt tail still leaves a wake.' },
  { id: 'cone', label: 'Cone', aliases: ['cone', 'arrow', 'arrowhead', 'spear', 'spike', 'traffic cone', 'wedge', 'triangle', 'dart'], build: cone,
    why: 'A sharp point splits the air, but the flat back end is as blunt as it gets. Pointy is not the same as streamlined.' },
  { id: 'dome', label: 'Dome', aliases: ['dome', 'half sphere', 'hemisphere', 'helmet', 'hat', 'bike helmet', 'igloo', 'mushroom'], build: dome,
    why: 'Round side into the wind. Cleaner than a plate, but the flat back still holds a wake.' },
  { id: 'cup', label: 'Parachute', aliases: ['parachute', 'cup', 'bowl', 'umbrella', 'bucket', 'open umbrella', 'sail', 'scoop'], build: cup,
    why: 'Open side into the wind. Air piles up inside and cannot escape, which is the whole point of a parachute.' },
  { id: 'fish', label: 'Fish', aliases: ['fish', 'tuna', 'shark', 'dolphin', 'whale', 'salmon', 'trout', 'orca'], build: fish,
    why: 'A tapered body with a thin tail. Evolution found the teardrop first.' },
  { id: 'bird', label: 'Bird', aliases: ['bird', 'swallow', 'falcon', 'eagle', 'penguin', 'pigeon', 'sparrow'], build: bird,
    why: 'Streamlined body, small tail. Birds are shaped by exactly the pressures the tunnel is measuring.' },
  { id: 'rocket', label: 'Rocket', aliases: ['rocket', 'spaceship', 'space shuttle', 'launcher'], build: rocket,
    why: 'Cone nose and fins at the back. The fins add surface but keep it pointed into the wind.' },
  { id: 'pencil', label: 'Pencil', aliases: ['pencil', 'pen', 'needle', 'stick', 'rod', 'javelin', 'ruler'], build: pencil,
    why: 'Long and thin with a point. Almost no frontal area, so almost no pressure drag.' },
  { id: 'bus', label: 'Bus', aliases: ['bus', 'school bus', 'coach', 'van', 'minivan', 'lorry', 'delivery van'], build: bus,
    why: 'A rolling brick with rounded corners. The flat back is the problem, not the front.' },
  { id: 'truck', label: 'Truck', aliases: ['truck', 'semi', 'pickup', 'pickup truck', 'tractor trailer', '18 wheeler', 'hgv'], build: truck,
    why: 'The step between cab and trailer traps air, and the flat trailer end sheds a huge wake.' },
  { id: 'car', label: 'Car', aliases: ['car', 'hatchback', 'sedan', 'family car', 'suv', 'jeep', 'taxi', 'tesla'], build: car,
    why: 'Sloped windscreen and a rounded roof keep the air attached over the top. The rear still separates.' },
  { id: 'sportscar', label: 'Sports car', aliases: ['sports car', 'sportscar', 'race car', 'racecar', 'supercar', 'f1 car', 'formula 1', 'ferrari', 'lamborghini', 'porsche', 'coupe'], build: sportsCar,
    why: 'Low and long. Less frontal area and a gentler roofline than a family car.' },
  { id: 'train', label: 'Train', aliases: ['train', 'bullet train', 'locomotive', 'tram', 'shinkansen', 'subway'], build: train,
    why: 'A long sloped nose cuts the front load. Length matters less than the shape of the two ends.' },
  { id: 'leaf', label: 'Leaf', aliases: ['leaf', 'feather', 'blade', 'knife', 'surfboard', 'ski', 'kayak', 'canoe', 'paddle'], build: leaf,
    why: 'Thin and nearly aligned with the wind. Tiny frontal area means tiny drag, until it tilts.' },
  { id: 'person', label: 'Person', aliases: ['person', 'human', 'man', 'woman', 'runner', 'cyclist', 'skier', 'someone standing', 'me'], build: person,
    why: 'Blunt and tall. A runner spends real energy pushing air, which is why cyclists tuck.' },
  { id: 'hand', label: 'Hand', aliases: ['hand', 'open hand', 'palm', 'fist', 'glove'], build: hand,
    why: 'Fingers spread is a wall; fingers together is a paddle. The tunnel can test your real hand in camera mode.' },
  { id: 'bottle', label: 'Bottle', aliases: ['bottle', 'water bottle', 'flask', 'thermos', 'can', 'soda can'], build: bottle,
    why: 'Neck first, it is a stepped cylinder. The shoulder is where the air lets go.' },
];

const normaliseText = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(a|an|the|of|my|some|one|two|big|small|little|large|tiny|huge|long|short|fast|slow|red|blue|green|yellow|black|white)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Finds a library shape for a description, or null. Longest alias wins. */
export function findShape(text) {
  const query = normaliseText(text);
  if (!query) return null;
  let best = null;
  let bestAlias = '';
  for (const shape of SHAPES) {
    for (const alias of shape.aliases) {
      const a = alias.toLowerCase();
      const hit = query === a || query.includes(` ${a} `) || query.startsWith(`${a} `) || query.endsWith(` ${a}`) || query === `${a}s` || query.endsWith(` ${a}s`);
      if (hit && a.length > bestAlias.length) {
        best = shape;
        bestAlias = a;
      }
    }
  }
  if (!best) return null;
  // Call it what the user called it ("Kayak"), not the library's family name ("Leaf").
  const label = bestAlias.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return { id: best.id, label, points: best.build(), why: best.why, source: 'library' };
}

/** Example pairs shown as chips. */
export const RACE_EXAMPLES = [
  ['a teardrop', 'a brick'],
  ['a bus', 'a sports car'],
  ['an egg', 'a ball'],
  ['a parachute', 'a dome'],
  ['a cone', 'a bullet'],
];

/**
 * Paints a unit-box polygon into the mask canvas at the standard test
 * position, keeping the body inside the same envelope the presets use.
 */
export function drawPolygon(mask, points, { heightFrac = 0.18, maxWidthFrac = 0.3 } = {}) {
  const ctx = mask.ctx;
  const w = mask.width;
  const h = mask.height;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const sw = Math.max(1e-3, maxX - minX);
  const sh = Math.max(1e-3, maxY - minY);
  const scale = Math.min((h * heightFrac) / sh, (w * maxWidthFrac) / sw);
  const cx = w * 0.3;
  const cy = h * 0.5;
  mask.clear();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, h * 0.006);
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const px = cx + (x - (minX + sw / 2)) * scale;
    const py = cy + (y - (minY + sh / 2)) * scale;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  mask.markDirty();
}

/** Validates a polygon from the AI endpoint. Returns a cleaned copy or null. */
export function cleanPolygon(raw) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 80) return null;
  const pts = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push([Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]);
  }
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  if (Math.abs(area) / 2 < 0.02) return null;
  return normalise(pts);
}
