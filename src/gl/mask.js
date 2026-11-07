import { createFBO } from './utils.js';

/**
 * The obstacle field lives in a CPU 2D canvas and in an RGBA8 WebGL texture.
 *
 * The test section is a wide 2:1 domain: `size` is the number of cells along
 * the short (vertical) axis, so the texture is `2 * size` wide by `size` tall.
 * CPU mask indexing is bottom-up (matching gl.readPixels): row 0 == v=0.
 */
export class MaskEditor {
  constructor(gl, size) {
    this.gl = gl;
    this.size = size;
    this.width = size * 2;
    this.height = size;
    this.dirty = true;
    this.cpuDirty = true;
    this.cpuMask = new Uint8Array(this.width * this.height);
    this.refLength = 0.6;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.target = createFBO(gl, this.width, this.height, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
    });

    this.upload();
  }

  get texture() {
    return this.target.texture;
  }

  resize(size) {
    if (size === this.size) return;
    const previous = this.canvas;
    const width = size * 2;
    const height = size;
    const next = document.createElement('canvas');
    next.width = width;
    next.height = height;
    const ctx = next.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(previous, 0, 0, width, height);

    const gl = this.gl;
    gl.deleteFramebuffer(this.target.fbo);
    gl.deleteTexture(this.target.texture);

    this.canvas = next;
    this.ctx = ctx;
    this.size = size;
    this.width = width;
    this.height = height;
    this.cpuMask = new Uint8Array(width * height);
    this.target = createFBO(gl, width, height, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.LINEAR,
    });
    this.markDirty();
    this.upload();
  }

  markDirty() {
    this.dirty = true;
    this.cpuDirty = true;
  }

  clear() {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.refLength = 0.6;
    this.markDirty();
  }

  drawPreset(name) {
    this.clear();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (name === 'cylinder') {
      ctx.beginPath();
      ctx.arc(w * 0.3, h * 0.5, h * 0.09, 0, Math.PI * 2);
      ctx.fill();
    } else if (name === 'plate') {
      ctx.beginPath();
      const bar = h * 0.018;
      const x = w * 0.3 - bar / 2;
      const y0 = h * 0.355;
      const y1 = h * 0.645;
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y0, bar, y1 - y0, bar * 0.48);
      } else {
        ctx.rect(x, y0, bar, y1 - y0);
      }
      ctx.fill();
    } else if (name === 'airfoil') {
      this.drawAirfoil();
    } else if (name === 'empty') {
      // Clear test section.
    }
  }

  drawAirfoil() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const chord = h * 0.62;
    const leX = w * 0.18;
    const cy = h * 0.5;
    const thickness = 0.12;
    const aoa = (-4.5 * Math.PI) / 180;
    const cos = Math.cos(aoa);
    const sin = Math.sin(aoa);
    const pivot = chord * 0.25;
    const upper = [];
    const lower = [];

    for (let i = 0; i <= 96; i += 1) {
      const xc = 0.5 * (1 - Math.cos((Math.PI * i) / 96));
      const yt =
        5 *
        thickness *
        (0.2969 * Math.sqrt(xc) -
          0.126 * xc -
          0.3516 * xc * xc +
          0.2843 * xc * xc * xc -
          0.1036 * xc * xc * xc * xc);

      const localX = xc * chord - pivot;
      const localY = yt * chord;
      const rx = localX * cos - localY * sin + pivot;
      const ry = localX * sin + localY * cos;
      upper.push([leX + rx, cy - ry]);

      const lowerX = localX * cos + localY * sin + pivot;
      const lowerY = localX * sin - localY * cos;
      lower.push([leX + lowerX, cy - lowerY]);
    }

    ctx.beginPath();
    ctx.moveTo(upper[0][0], upper[0][1]);
    for (let i = 1; i < upper.length; i += 1) ctx.lineTo(upper[i][0], upper[i][1]);
    for (let i = lower.length - 1; i >= 0; i -= 1) ctx.lineTo(lower[i][0], lower[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  upload() {
    if (!this.dirty) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.target.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.canvas,
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.dirty = false;
  }

  /** Called once per frame by the solver. */
  flush() {
    this.upload();
  }

  /** Bottom-up binary mask, matching solver texture coordinates. */
  getCpuMask() {
    if (!this.cpuDirty) return this.cpuMask;

    const { width, height, ctx } = this;
    const image = ctx.getImageData(0, 0, width, height).data;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let any = false;

    for (let y = 0; y < height; y += 1) {
      const srcRow = (height - 1 - y) * width * 4;
      for (let x = 0; x < width; x += 1) {
        const solid = image[srcRow + x * 4] > 127 ? 1 : 0;
        const index = y * width + x;
        this.cpuMask[index] = solid;
        if (solid) {
          any = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    this.refLength = any
      ? Math.max((maxX - minX + 1) / this.size, (maxY - minY + 1) / this.size)
      : 0.6;
    this.cpuDirty = false;
    return this.cpuMask;
  }

  bindInput(overlay, cursor, store) {
    let drawing = false;
    let erase = false;
    let last = null;

    const point = (event) => {
      const rect = overlay.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: 1 - (event.clientY - rect.top) / rect.height,
        rect,
      };
    };

    const paint = (from, to, radiusPx, rect) => {
      const width = this.width;
      const height = this.height;
      const radius = Math.max(1.5, (radiusPx / rect.width) * width);
      const ctx = this.ctx;
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = erase ? '#000' : '#fff';
      ctx.fillStyle = erase ? '#000' : '#fff';
      ctx.lineWidth = radius * 2;
      ctx.lineCap = 'round';

      if (from) {
        ctx.beginPath();
        ctx.moveTo(from.x * width, (1 - from.y) * height);
        ctx.lineTo(to.x * width, (1 - to.y) * height);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(to.x * width, (1 - to.y) * height, radius, 0, Math.PI * 2);
      ctx.fill();

      this.markDirty();
    };

    const updateCursor = (event) => {
      const rect = overlay.getBoundingClientRect();
      cursor.style.opacity = '1';
      cursor.style.width = `${store.state.brush * 2}px`;
      cursor.style.height = `${store.state.brush * 2}px`;
      cursor.style.transform = `translate(${event.clientX - rect.left - store.state.brush}px, ${
        event.clientY - rect.top - store.state.brush
      }px)`;
      cursor.style.borderColor =
        store.state.tool === 'erase' ? 'rgba(232,156,120,0.9)' : 'rgba(244,238,218,0.9)';
    };

    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      const p = point(event);
      drawing = true;
      erase = store.state.tool === 'erase' || event.button === 2 || event.shiftKey;
      last = p;
      overlay.setPointerCapture(event.pointerId);
      paint(null, p, store.state.brush, p.rect);
      updateCursor(event);

      if (store.state.preset !== 'custom') {
        store.patch({ preset: 'custom' });
      }
    });

    overlay.addEventListener('pointermove', (event) => {
      updateCursor(event);
      if (!drawing) return;
      const p = point(event);
      paint(last, p, store.state.brush, p.rect);
      last = p;
      this.upload();
    });

    const end = (event) => {
      if (!drawing) return;
      drawing = false;
      last = null;
      this.upload();
      if (overlay.hasPointerCapture(event.pointerId)) {
        overlay.releasePointerCapture(event.pointerId);
      }
    };

    overlay.addEventListener('pointerup', end);
    overlay.addEventListener('pointercancel', end);
    overlay.addEventListener('pointerleave', () => {
      cursor.style.opacity = '0';
    });
    overlay.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  dispose() {
    this.gl.deleteFramebuffer(this.target.fbo);
    this.gl.deleteTexture(this.target.texture);
  }
}
