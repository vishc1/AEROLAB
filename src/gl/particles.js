import { Program, createDoubleFBO } from './utils.js';
import {
  FULLSCREEN_VERTEX,
  PARTICLE_UPDATE_FRAGMENT,
  PARTICLE_VERTEX,
  PARTICLE_FRAGMENT,
} from './shaders.js';

/**
 * Texture-backed particle system. A 256×256 RGBA32F field holds 65,536
 * particles. Each frame a fullscreen fragment pass advances every particle
 * with RK2 through the sampled velocity field.
 *
 *   R,G = position (UV)
 *   B   = last sampled speed
 *   A   = remaining life (seconds)
 */
export class ParticleSystem {
  constructor(gl, quad) {
    this.gl = gl;
    this.quad = quad;
    this.res = 256;
    this.maxParticles = this.res * this.res;
    this.time = 0;

    this.updateProgram = new Program(
      gl,
      FULLSCREEN_VERTEX,
      PARTICLE_UPDATE_FRAGMENT,
      'particle-update',
    );
    this.renderProgram = new Program(gl, PARTICLE_VERTEX, PARTICLE_FRAGMENT, 'particle-render');

    const targetOptions = {
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      filter: gl.NEAREST,
    };
    this.particles = createDoubleFBO(gl, this.res, this.res, targetOptions);
    this.vao = gl.createVertexArray();
    this.seed();
  }

  seed() {
    const gl = this.gl;
    const count = this.maxParticles;
    const data = new Float32Array(count * 4);

    for (let i = 0; i < count; i += 1) {
      const index = i * 4;
      data[index] = 0.01 + Math.random() * 0.98;
      data[index + 1] = 0.015 + Math.random() * 0.97;
      data[index + 2] = 0;
      data[index + 3] = Math.random() * 6 + 0.4;
    }

    for (const target of [this.particles.read, this.particles.write]) {
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        this.res,
        this.res,
        0,
        gl.RGBA,
        gl.FLOAT,
        data,
      );
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  update(dt, fluid) {
    const gl = this.gl;
    this.time += dt;
    const texel = [1 / fluid.width, 1 / fluid.height];
    const invDomain = [fluid.size / fluid.width, fluid.size / fluid.height];

    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.particles.write.fbo);
    gl.viewport(0, 0, this.res, this.res);

    this.updateProgram
      .use()
      .set('uTexel', texel)
      .set('uInvDomain', invDomain)
      .set('uDt', dt)
      .set('uTime', this.time)
      .setTexture('uParticles', this.particles.read.texture, 0)
      .setTexture('uVelocity', fluid.velocity.read.texture, 1)
      .setTexture('uObstacle', fluid.mask.texture, 2);
    this.quad.draw();

    this.particles.swap();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(fluid, params) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const halfWidth = (0.9 * dpr) / Math.max(1, gl.drawingBufferWidth);

    this.renderProgram
      .use()
      .set('uTexel', [1 / fluid.width, 1 / fluid.height])
      .set('uInvDomain', [fluid.size / fluid.width, fluid.size / fluid.height])
      .set('uCell', 1 / fluid.size)
      .set('uAspect', fluid.width / fluid.height)
      .set('uParticleRes', [this.res, this.res])
      .set('uInlet', Math.max(0.03, params.inlet))
      .set('uDensity', params.density ?? 0.9)
      .set('uTrailTime', params.trailTime ?? 0.09)
      .set('uWidth', halfWidth)
      .setTexture('uParticles', this.particles.read.texture, 0)
      .setTexture('uVelocity', fluid.velocity.read.texture, 1)
      .setTexture('uObstacle', fluid.mask.texture, 2);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.maxParticles * 6);
    gl.bindVertexArray(null);

    gl.disable(gl.BLEND);
  }

  dispose() {
    this.particles.dispose();
    this.updateProgram.dispose();
    this.renderProgram.dispose();
    this.gl.deleteVertexArray(this.vao);
  }
}
