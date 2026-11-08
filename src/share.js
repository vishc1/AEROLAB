/**
 * Share a design as a link. The silhouette is run-length encoded into the URL
 * hash, so nothing is uploaded and no backend is needed. Opening the link
 * paints the shape into the tunnel and pins it as the baseline to beat.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '';
    out += i + 2 < bytes.length ? B64[c & 63] : '';
  }
  return out;
}

function b64ToBytes(text) {
  const map = new Map([...B64].map((ch, i) => [ch, i]));
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of text) {
    const v = map.get(ch);
    if (v === undefined) throw new Error('bad share code');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}

/** Encodes the solid cells of a mask canvas: version.width.height.rle */
export function encodeMask(maskCanvas) {
  const w = maskCanvas.width;
  const h = maskCanvas.height;
  const data = maskCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const runs = [];
  let current = 0;
  let run = 0;
  for (let i = 0; i < w * h; i += 1) {
    const solid = data[i * 4] > 127 ? 1 : 0;
    if (solid === current) run += 1;
    else {
      runs.push(run);
      current = solid;
      run = 1;
    }
  }
  runs.push(run);
  const bytes = [];
  for (let n of runs) {
    while (n >= 128) {
      bytes.push((n & 127) | 128);
      n >>= 7;
    }
    bytes.push(n);
  }
  return `1.${w}.${h}.${bytesToB64(Uint8Array.from(bytes))}`;
}

/** Decodes a share code into a canvas of solid (white) cells, or null. */
export function decodeMask(code) {
  const parts = String(code || '').split('.');
  if (parts.length !== 4 || parts[0] !== '1') return null;
  const w = Number(parts[1]);
  const h = Number(parts[2]);
  if (!(w > 0 && h > 0 && w * h <= 1 << 20)) return null;
  const bytes = b64ToBytes(parts[3]);
  const runs = [];
  let value = 0;
  let shift = 0;
  for (const byte of bytes) {
    value |= (byte & 127) << shift;
    if (byte & 128) shift += 7;
    else {
      runs.push(value);
      value = 0;
      shift = 0;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  let i = 0;
  let solid = 0;
  for (const run of runs) {
    if (solid) {
      for (let k = 0; k < run && i + k < w * h; k += 1) {
        const o = (i + k) * 4;
        image.data[o] = 255;
        image.data[o + 1] = 255;
        image.data[o + 2] = 255;
        image.data[o + 3] = 255;
      }
    }
    i += run;
    solid ^= 1;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function parseShareHash(hash) {
  const text = String(hash || '').replace(/^#/, '');
  if (!text.includes('d=')) return null;
  const params = new URLSearchParams(text);
  const code = params.get('d');
  if (!code) return null;
  return {
    code,
    cd: Number(params.get('cd')),
    cl: Number(params.get('cl')),
    name: (params.get('n') || 'Shared design').slice(0, 40),
  };
}

export function buildShareUrl({ maskCanvas, cd, cl, name }) {
  const params = new URLSearchParams();
  params.set('d', encodeMask(maskCanvas));
  if (Number.isFinite(cd)) params.set('cd', cd.toFixed(3));
  if (Number.isFinite(cl)) params.set('cl', cl.toFixed(3));
  params.set('n', name.slice(0, 40));
  return `${location.origin}${location.pathname}#${params.toString()}`;
}

export function createShare(store, { mask, labelFor, applyShared, setBaseline }) {
  const $ = (id) => document.getElementById(id);
  const button = $('share-design');
  const banner = $('share-banner');
  const bannerText = $('share-banner-text');
  const bannerClose = $('share-banner-close');
  let resetLabel = null;

  button.addEventListener('click', async () => {
    const m = store.state.metrics;
    if (!(m.boundaryCells > 0)) return;
    const url = buildShareUrl({ maskCanvas: mask.canvas, cd: m.cd, cl: m.cl, name: labelFor(store.state) });
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      /* clipboard refused: fall back to the address bar */
    }
    if (!copied) history.replaceState(null, '', url);
    button.textContent = copied ? 'Link copied' : 'Link in address bar';
    button.classList.add('is-done');
    clearTimeout(resetLabel);
    resetLabel = setTimeout(() => {
      button.textContent = 'Share design';
      button.classList.remove('is-done');
    }, 2200);
  });

  bannerClose.addEventListener('click', () => {
    banner.hidden = true;
  });

  const loadFromHash = () => {
    const shared = parseShareHash(location.hash);
    if (!shared) return false;
    let canvas = null;
    try {
      canvas = decodeMask(shared.code);
    } catch {
      canvas = null;
    }
    if (!canvas) return false;
    applyShared(canvas);
    const cdText = Number.isFinite(shared.cd) ? ` · Cd ${shared.cd.toFixed(3)}` : '';
    bannerText.textContent = `${shared.name}${cdText}. Sculpt it, pin it, beat it.`;
    banner.hidden = false;
    if (Number.isFinite(shared.cd)) {
      setBaseline({ cd: shared.cd, cl: Number.isFinite(shared.cl) ? shared.cl : 0, name: shared.name, canvas });
    }
    return true;
  };

  return { loadFromHash, encodeMask, decodeMask };
}
