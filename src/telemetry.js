/**
 * Reads the pressure field back to the CPU with a pixel-pack buffer + fence so
 * the GPU is not stalled every frame. Boundary pressure forces are integrated
 * on a small surface loop and pushed through the state bus at UI-friendly rate.
 */

class PressureReadback {
  constructor(gl, width, height) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.inFlight = false;
    this.sync = null;
    this.pbo = gl.createBuffer();
    this.byteSize = width * height * 4 * 4;
    this.data = new Float32Array(width * height * 4);

    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.byteSize, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.dispose();
    this.width = width;
    this.height = height;
    this.byteSize = width * height * 4 * 4;
    this.data = new Float32Array(width * height * 4);

    const gl = this.gl;
    this.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.byteSize, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  request(fbo) {
    if (this.inFlight) return false;
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    // Orphan the previous allocation so the driver can hand us a fresh
    // readback page instead of serialising on the old one.
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.byteSize, gl.STREAM_READ);
    gl.readPixels(
      0,
      0,
      this.width,
      this.height,
      gl.RGBA,
      gl.FLOAT,
      0,
    );
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    this.inFlight = true;
    return true;
  }

  poll() {
    if (!this.inFlight || !this.sync) return null;
    const gl = this.gl;
    const status = gl.clientWaitSync(this.sync, 0, 0);

    if (status === gl.TIMEOUT_EXPIRED) return null;
    if (status === gl.WAIT_FAILED) {
      gl.deleteSync(this.sync);
      this.sync = null;
      this.inFlight = false;
      return null;
    }

    gl.deleteSync(this.sync);
    this.sync = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.data);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.inFlight = false;
    return this.data;
  }

  dispose() {
    const gl = this.gl;
    if (this.sync) gl.deleteSync(this.sync);
    if (this.pbo) gl.deleteBuffer(this.pbo);
    this.sync = null;
    this.pbo = null;
    this.inFlight = false;
  }
}

export class Telemetry {
  constructor(gl) {
    this.gl = gl;
    this.readback = null;
    this.size = 0;
    this.lastRequest = 0;
    this.pending = null;
    this.cd = 0;
    this.cl = 0;
    this.fd = 0;
    this.fl = 0;
    this.samples = 0;
    this.history = [];
    this.lastRaw = { cd: 0, cl: 0 };
  }

  configure(size) {
    if (this.readback) this.readback.dispose();
    this.size = size;
    this.readback = new PressureReadback(this.gl, size * 2, size);
    this.history.length = 0;
  }

  reset() {
    this.cd = 0;
    this.cl = 0;
    this.fd = 0;
    this.fl = 0;
    this.samples = 0;
    this.history.length = 0;
    this.pending = null;
  }

  resize(size) {
    if (size === this.size) return;
    this.size = size;
    this.readback.resize(size * 2, size);
    this.history.length = 0;
  }

  maybeRequest(fluid, params, now) {
    if (!this.readback) return;
    if (this.readback.inFlight) return;
    if (now - this.lastRequest < 90) return;
    if (!this.readback.request(fluid.pressure.read.fbo)) return;

    this.lastRequest = now;
    this.pending = {
      dt: fluid.lastDt,
      inlet: fluid.inlet,
      windSpeed: params.windSpeed,
      viscosity: params.viscosity,
    };
  }

  poll(fluid, store) {
    if (!this.readback) return;
    const pressure = this.readback.poll();
    if (!pressure) return;

    const mask = fluid.mask.getCpuMask();
    const width = fluid.width;
    const height = fluid.height;
    const ds = 1 / fluid.size;
    const pending = this.pending;
    if (!pending) return;

    const u = Math.max(pending.inlet, 0.02);
    const reference = Math.max(0.5 * u * u * pending.dt, 1e-9);
    let dragIntegral = 0;
    let liftIntegral = 0;
    let boundaryCells = 0;

    // Only cells on the solid/fluid interface contribute pressure force.
    for (let y = 1; y < height - 1; y += 1) {
      const row = y * width;
      for (let x = 1; x < width - 1; x += 1) {
        const index = row + x;
        if (mask[index] !== 1) continue;

        const neighbours = [
          [x - 1, y, -1, 0],
          [x + 1, y, 1, 0],
          [x, y - 1, 0, -1],
          [x, y + 1, 0, 1],
        ];

        for (let k = 0; k < 4; k += 1) {
          const [nx, ny, dx, dy] = neighbours[k];
          const neighbour = ny * width + nx;
          if (mask[neighbour] === 1) continue;

          const p = pressure[neighbour * 4];
          let cp = p / reference;
          if (!Number.isFinite(cp)) continue;
          cp = Math.max(-24, Math.min(24, cp));

          // Force on the body is -p * n, where n points solid -> fluid.
          dragIntegral += cp * -dx * ds;
          liftIntegral += cp * -dy * ds;
          boundaryCells += 1;
        }
      }
    }

    const refLength = Math.max(fluid.mask.refLength, 0.04);
    const rawCd = dragIntegral / refLength;
    const rawCl = liftIntegral / refLength;

    // Exponential smoothing keeps the gauges readable while preserving the
    // unsteady signature of vortex shedding.
    const alpha = this.samples < 3 ? 0.75 : 0.22;
    this.cd += (rawCd - this.cd) * alpha;
    this.cl += (rawCl - this.cl) * alpha;
    this.samples += 1;

    const q = 0.5 * 1.225 * pending.windSpeed * pending.windSpeed;
    this.fd += (q * dragIntegral - this.fd) * alpha;
    this.fl += (q * liftIntegral - this.fl) * alpha;

    const re = (pending.windSpeed * 1.0) / Math.max(pending.viscosity, 0.0001);
    const regime = re < 180 ? 'LAMINAR' : re < 1200 ? 'TRANSITIONAL' : 'TURBULENT';

    this.lastRaw = { cd: rawCd, cl: rawCl };
    this.history.push(this.cd);
    if (this.history.length > 140) this.history.shift();

    store.patch({
      metrics: {
        cd: this.cd,
        cl: this.cl,
        fd: this.fd,
        fl: this.fl,
        re,
        regime,
        refLength,
        boundaryCells,
        iterations: fluid.iterations,
        history: this.history.slice(),
      },
    });
  }

  dispose() {
    this.readback?.dispose();
  }
}
