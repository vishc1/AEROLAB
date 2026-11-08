/**
 * Export a report card: the live tunnel frame, the measured coefficients, the
 * road-speed translation and mission progress, rendered to a PNG the student
 * can hand in or post.
 */
import { roadImpact } from './impact.js';

const W = 1200;
const H = 800;

function tile(ctx, x, y, w, label, value, unit, color) {
  ctx.fillStyle = 'rgba(230,242,224,0.5)';
  ctx.font = '500 11px "SF Mono", ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label.toUpperCase(), x, y);
  ctx.fillStyle = color;
  ctx.font = '400 38px "Instrument Serif", Georgia, serif';
  ctx.fillText(value, x, y + 44);
  if (unit) {
    ctx.fillStyle = 'rgba(230,242,224,0.5)';
    ctx.font = '500 11px "SF Mono", ui-monospace, monospace';
    ctx.fillText(unit, x + ctx.measureText(value).width * 1.9 + 8, y + 44);
  }
}

export function createReport(store, { captureFrame, labelFor, missionsDone, baseline }) {
  const button = document.getElementById('export-report');
  let busy = false;

  const render = async () => {
    const s = store.state;
    const m = s.metrics;
    const frame = await captureFrame();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#07100f';
    ctx.fillRect(0, 0, W, H);

    // header
    ctx.fillStyle = '#d9ff3f';
    ctx.font = '600 13px "SF Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('AEROLAB · TEST REPORT', 40, 44);
    ctx.fillStyle = 'rgba(230,242,224,0.55)';
    ctx.font = '500 12px "SF Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }), W - 40, 44);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f2ead6';
    ctx.font = '400 34px "Instrument Serif", Georgia, serif';
    ctx.fillText(labelFor(s), 40, 88);

    // tunnel frame, 2:1
    const fx = 40;
    const fy = 108;
    const fw = W - 80;
    const fh = fw / 2;
    ctx.fillStyle = '#031019';
    ctx.fillRect(fx, fy, fw, fh);
    if (frame) {
      const img = new Image();
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
        img.src = frame;
      });
      if (img.width) ctx.drawImage(img, fx, fy, fw, fh);
    }
    ctx.strokeStyle = 'rgba(230,242,224,0.14)';
    ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);

    // stats band
    const by = fy + fh + 38;
    const ld = Math.abs(m.cd) > 0.001 ? m.cl / m.cd : 0;
    const road = roadImpact(m.cd);
    const col = (W - 80) / 5;
    tile(ctx, 40, by, col, 'Relative drag · Cd', m.cd.toFixed(3), '', '#d9ff3f');
    tile(ctx, 40 + col, by, col, 'Relative lift · Cl', `${m.cl < 0 ? '−' : '+'}${Math.abs(m.cl).toFixed(3)}`, '', '#f2ead6');
    tile(ctx, 40 + col * 2, by, col, 'Lift / drag', ld.toFixed(2), '', '#f2ead6');
    tile(ctx, 40 + col * 3, by, col, 'Car · 100 km/h', road ? road.litresPer100km.toFixed(1) : '—', 'L / 100 km', '#72ecc4');
    tile(ctx, 40 + col * 4, by, col, 'CO₂', road ? String(Math.round(road.co2gPerKm)) : '—', 'g / km', '#72ecc4');

    // footer
    ctx.fillStyle = 'rgba(230,242,224,0.45)';
    ctx.font = '500 11px "SF Mono", ui-monospace, monospace';
    const b = baseline();
    const parts = [
      `RE ${Math.round(m.re)} · ${m.regime}`,
      `${s.dim.toUpperCase()} SOLVER · ${s.windSpeed.toFixed(1)} M/S`,
      `MISSIONS ${missionsDone()} / 8`,
      b ? `VS ${b.name.toUpperCase()}: ${Math.round(((m.cd - b.cd) / Math.max(b.cd, 1e-6)) * 100)}% DRAG` : null,
    ].filter(Boolean);
    ctx.fillText(parts.join('   ·   '), 40, H - 18);
    ctx.textAlign = 'right';
    ctx.fillText(location.host.toUpperCase() || 'AEROLAB', W - 40, H - 18);

    return canvas.toDataURL('image/png');
  };

  button.addEventListener('click', async () => {
    if (busy || !(store.state.metrics.boundaryCells > 0)) return;
    busy = true;
    button.textContent = 'Rendering…';
    try {
      const url = await render();
      const a = document.createElement('a');
      const slug = labelFor(store.state).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      a.href = url;
      a.download = `aerolab-report-${slug}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      button.textContent = 'Saved';
    } catch (error) {
      console.error(error);
      button.textContent = 'Export failed';
    } finally {
      setTimeout(() => {
        button.textContent = 'Export report';
        busy = false;
      }, 1800);
    }
  });

  return { render };
}
