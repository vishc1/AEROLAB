import { Program } from './utils.js';
import { FULLSCREEN_VERTEX, BACKGROUND_FRAGMENT } from './shaders.js';

export class Renderer {
  constructor(gl, quad) {
    this.gl = gl;
    this.quad = quad;
    this.background = new Program(gl, FULLSCREEN_VERTEX, BACKGROUND_FRAGMENT, 'background');
  }

  render(fluid, particles, params) {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    this.background
      .use()
      .set('uTexel', [1 / fluid.width, 1 / fluid.height])
      .set('uCell', 1 / fluid.size)
      .set('uInlet', Math.max(0.03, params.inlet))
      .set('uTime', fluid.time)
      .setTexture('uVelocity', fluid.velocity.read.texture, 0)
      .setTexture('uObstacle', fluid.mask.texture, 1);
    this.quad.draw();

    particles.render(fluid, params);
  }

  resize() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  dispose() {
    this.background.dispose();
  }
}
