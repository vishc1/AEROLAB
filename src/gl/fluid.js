import {
  Program,
  createDoubleFBO,
  createFBO,
  bindTarget,
  clearTarget,
} from './utils.js';
import {
  FULLSCREEN_VERTEX,
  ADVECT_FRAGMENT,
  DIVERGENCE_FRAGMENT,
  JACOBI_FRAGMENT,
  GRADIENT_FRAGMENT,
} from './shaders.js';

/**
 * GPU incompressible Navier–Stokes solver.
 *
 * Field layout
 *   velocity    RGBA16F (u, v, 0, 1)   — ping-pong
 *   pressure    RGBA32F (p, 0, 0, 1)   — ping-pong, float readback
 *   divergence  RGBA16F (div, 0, 0, 1)
 *   obstacle    RGBA8   (mask, ...)    — uploaded by MaskEditor
 */
export class FluidSim {
  constructor(gl, quad, mask) {
    this.gl = gl;
    this.quad = quad;
    this.mask = mask;
    this.size = mask.size;
    this.width = mask.width ?? mask.size * 2;
    this.height = mask.height ?? mask.size;
    this.time = 0;
    this.lastDt = 1 / 60;
    this.inlet = 0.41;
    this.iterations = this.preferredIterations();

    this.advect = new Program(gl, FULLSCREEN_VERTEX, ADVECT_FRAGMENT, 'advect');
    this.divergence = new Program(gl, FULLSCREEN_VERTEX, DIVERGENCE_FRAGMENT, 'divergence');
    this.jacobi = new Program(gl, FULLSCREEN_VERTEX, JACOBI_FRAGMENT, 'jacobi');
    this.gradient = new Program(gl, FULLSCREEN_VERTEX, GRADIENT_FRAGMENT, 'gradient');

    const halfFloat = {
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.HALF_FLOAT,
      filter: gl.LINEAR,
    };
    const nearestHalf = { ...halfFloat, filter: gl.NEAREST };
    const nearestFloat = {
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      filter: gl.NEAREST,
    };

    this.velocity = createDoubleFBO(gl, this.width, this.height, halfFloat);
    this.pressure = createDoubleFBO(gl, this.width, this.height, nearestFloat);
    this.divergenceField = createFBO(gl, this.width, this.height, nearestHalf);

    this.clearFields();
  }

  preferredIterations() {
    if (this.size >= 256) return 44;
    if (this.size >= 192) return 38;
    return 32;
  }

  clearFields() {
    const gl = this.gl;
    const w = this.width;
    const h = this.height;
    clearTarget(gl, this.velocity.read, w, h);
    clearTarget(gl, this.velocity.write, w, h);
    clearTarget(gl, this.pressure.read, w, h);
    clearTarget(gl, this.pressure.write, w, h);
    clearTarget(gl, this.divergenceField, w, h);
    this.time = 0;
  }

  /**
   * Start from a uniform freestream instead of an empty pipe. The flow is
   * instantly visible after a reset / geometry change while the solver still
   * develops the body's wake naturally.
   */
  resetFlow(inlet = 0.41) {
    const gl = this.gl;
    const w = this.width;
    const h = this.height;
    clearTarget(gl, this.velocity.read, w, h, [inlet, 0, 0, 1]);
    clearTarget(gl, this.velocity.write, w, h, [inlet, 0, 0, 1]);
    clearTarget(gl, this.pressure.read, w, h);
    clearTarget(gl, this.pressure.write, w, h);
    clearTarget(gl, this.divergenceField, w, h);
    this.time = 0;
    this.inlet = inlet;
  }

  resize(size) {
    if (size === this.size) return;
    this.disposeTargets();
    this.size = size;
    this.width = size * 2;
    this.height = size;
    this.iterations = this.preferredIterations();

    const gl = this.gl;
    const halfFloat = {
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.HALF_FLOAT,
      filter: gl.LINEAR,
    };
    const nearestHalf = { ...halfFloat, filter: gl.NEAREST };
    const nearestFloat = {
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      filter: gl.NEAREST,
    };

    this.velocity = createDoubleFBO(gl, this.width, this.height, halfFloat);
    this.pressure = createDoubleFBO(gl, this.width, this.height, nearestFloat);
    this.divergenceField = createFBO(gl, this.width, this.height, nearestHalf);
    this.resetFlow(this.inlet || 0.41);
  }

  step(dt, params) {
    const gl = this.gl;
    const width = this.width;
    const height = this.height;
    const cell = 1 / this.size;
    // Physical test section is `width / size` × `height / size` = 2 × 1.
    const invDomain = [this.size / width, this.size / height];
    const dtSafe = Math.min(Math.max(dt, 1 / 240), 1 / 30);
    const inlet = Math.max(0.03, params.inlet);
    const texel = [1 / width, 1 / height];
    this.time += dtSafe;
    this.lastDt = dtSafe;
    this.inlet = inlet;
    this.iterations = params.iterations ?? this.preferredIterations();

    this.mask.flush();

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // 1) Semi-Lagrangian self-advection. -----------------------------------
    bindTarget(gl, this.velocity.write, width, height);
    this.advect
      .use()
      .set('uTexel', texel)
      .set('uDt', dtSafe)
      .set('uInlet', inlet)
      .set('uTime', this.time)
      .set('uDissipation', 0.9998)
      .set('uViscosity', params.viscosity)
      .set('uInvDomain', invDomain)
      .setTexture('uVelocity', this.velocity.read.texture, 0)
      .setTexture('uObstacle', this.mask.texture, 1);
    this.quad.draw();
    this.velocity.swap();

    // 2) Divergence of the intermediate velocity. --------------------------
    bindTarget(gl, this.divergenceField, width, height);
    this.divergence
      .use()
      .set('uTexel', texel)
      .set('uCell', cell)
      .setTexture('uVelocity', this.velocity.read.texture, 0)
      .setTexture('uObstacle', this.mask.texture, 1);
    this.quad.draw();

    // 3) Jacobi iterations for laplacian(p) = divergence. -------------------
    this.jacobi.use().set('uTexel', texel).set('uDx2', cell * cell);
    this.jacobi.setTexture('uObstacle', this.mask.texture, 1);
    this.jacobi.setTexture('uDivergence', this.divergenceField.texture, 2);

    for (let i = 0; i < this.iterations; i += 1) {
      bindTarget(gl, this.pressure.write, width, height);
      this.jacobi.setTexture('uPressure', this.pressure.read.texture, 0);
      this.quad.draw();
      this.pressure.swap();
    }

    // 4) Subtract the pressure gradient, projecting onto a divergence-free
    //    velocity field. ----------------------------------------------------
    bindTarget(gl, this.velocity.write, width, height);
    this.gradient
      .use()
      .set('uTexel', texel)
      .set('uCell', cell)
      .set('uInlet', inlet)
      .set('uTime', this.time)
      .set('uMaxVelocity', Math.max(0.95, inlet * 4.5))
      .setTexture('uVelocity', this.velocity.read.texture, 0)
      .setTexture('uPressure', this.pressure.read.texture, 1)
      .setTexture('uObstacle', this.mask.texture, 2);
    this.quad.draw();
    this.velocity.swap();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  disposeTargets() {
    this.velocity?.dispose();
    this.pressure?.dispose();
    if (this.divergenceField) {
      this.gl.deleteFramebuffer(this.divergenceField.fbo);
      this.gl.deleteTexture(this.divergenceField.texture);
    }
  }

  dispose() {
    this.disposeTargets();
    this.advect.dispose();
    this.divergence.dispose();
    this.jacobi.dispose();
    this.gradient.dispose();
  }
}
