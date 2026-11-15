// Solver validation. `measured` values come from scripts/validate.mjs (2D mode,
// 192 grid, 5 s average after settling); `ref` are textbook 2D drag coefficients.
// Re-run the script and update these if the solver changes.
export const CASES = [
  { shape: 'Cylinder', re: 692, measured: 1.03, ref: [0.9, 1.3], source: 'Re 10^3 to 10^5 plateau, about 1.0 to 1.2' },
  { shape: 'Cylinder', re: 180, measured: 0.6, ref: [1.2, 1.5], source: 'Re ~100 to 200, about 1.3' },
  { shape: 'Cylinder', re: 90, measured: 0.48, ref: [1.3, 1.6], source: 'Re ~90, about 1.4' },
  { shape: 'Flat plate (face on)', re: 692, measured: 1.29, ref: [1.8, 2.1], source: 'Infinite 2D plate, about 1.98' },
  { shape: 'Airfoil, NACA 0012 at 4.5°', re: 692, measured: 0.06, ref: [0.01, 0.1], source: 'Thin streamlined body, low drag' },
];

export function verdict(c) {
  if (c.measured >= c.ref[0] && c.measured <= c.ref[1]) return ['pass', 'In range'];
  return ['low', `Reads ${Math.round((1 - c.measured / ((c.ref[0] + c.ref[1]) / 2)) * 100)}% low`];
}

export function initValidation() {
  const body = document.getElementById('validation-rows');
  if (!body) return;
  body.innerHTML = CASES.map((c) => {
    const [cls, text] = verdict(c);
    return `<tr><td>${c.shape}</td><td>${c.re}</td><td>${c.measured.toFixed(2)}</td>` +
      `<td>${c.ref[0]} to ${c.ref[1]}</td><td><span class="vstat ${cls}">${text}</span></td>` +
      `<td class="vsrc">${c.source}</td></tr>`;
  }).join('');
}

// Physics page: same data, the page's own compact five-column format.
export function initAccuracyTable() {
  const body = document.getElementById('accuracy-rows');
  if (!body) return;
  body.innerHTML = CASES.map((c) => {
    const [cls, text] = verdict(c);
    return `<tr><td>${c.shape}</td><td>${c.re}</td><td>${c.measured.toFixed(2)}</td>` +
      `<td>${c.ref[0]} – ${c.ref[1]}</td><td class="${cls === 'pass' ? 'ok' : 'low'}">${text}</td></tr>`;
  }).join('');
}
