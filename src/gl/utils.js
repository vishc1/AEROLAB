/**
 * Small WebGL2 toolkit: context creation, program compilation, FBOs and a
 * fullscreen quad. Keeping this dependency-free makes the renderer portable.
 */

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });

  if (!gl) throw new Error('WebGL2 is not available in this browser.');

  const colorFloat = gl.getExtension('EXT_color_buffer_float');
  if (!colorFloat) {
    throw new Error(
      'EXT_color_buffer_float is unavailable. This simulation needs float render targets.',
    );
  }

  // Needed for linear filtering of RGBA32F on some drivers. Half-float
  // filtering is core in WebGL2, but attempting this keeps 32F usable too.
  gl.getExtension('OES_texture_float_linear');

  return gl;
}

export function compileShader(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed (${label}):\n${log}`);
  }
  return shader;
}

export class Program {
  constructor(gl, vertexSource, fragmentSource, label = 'program') {
    this.gl = gl;
    this.label = label;
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} vertex`);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link failed (${label}):\n${log}`);
    }

    this.program = program;
    this.uniforms = new Map();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      this.uniforms.set(name, gl.getUniformLocation(program, info.name));
    }
  }

  use() {
    this.gl.useProgram(this.program);
    return this;
  }

  set(name, value) {
    const gl = this.gl;
    const location = this.uniforms.get(name);
    if (location === undefined || location === null) return this;

    if (typeof value === 'number') {
      gl.uniform1f(location, value);
    } else if (typeof value === 'boolean') {
      gl.uniform1i(location, value ? 1 : 0);
    } else if (value?.length === 2) {
      gl.uniform2f(location, value[0], value[1]);
    } else if (value?.length === 3) {
      gl.uniform3f(location, value[0], value[1], value[2]);
    } else if (value?.length === 4) {
      gl.uniform4f(location, value[0], value[1], value[2], value[3]);
    }
    return this;
  }

  setInt(name, value) {
    const location = this.uniforms.get(name);
    if (location !== undefined && location !== null) {
      this.gl.uniform1i(location, value);
    }
    return this;
  }

  setTexture(name, texture, unit) {
    const gl = this.gl;
    const location = this.uniforms.get(name);
    if (location === undefined || location === null) return this;

    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
    return this;
  }

  dispose() {
    this.gl.deleteProgram(this.program);
  }
}

export function createTexture(
  gl,
  width,
  height,
  {
    internalFormat = gl.RGBA16F,
    format = gl.RGBA,
    type = gl.HALF_FLOAT,
    filter = gl.LINEAR,
    wrap = gl.CLAMP_TO_EDGE,
    data = null,
  } = {},
) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

export function createFBO(gl, width, height, options = {}) {
  const texture = createTexture(gl, width, height, options);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    throw new Error(`Incomplete framebuffer: 0x${status.toString(16)}`);
  }

  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    fbo,
    texture,
    width,
    height,
    texelSize: [1 / width, 1 / height],
  };
}

export function createDoubleFBO(gl, width, height, options) {
  let read = createFBO(gl, width, height, options);
  let write = createFBO(gl, width, height, options);

  return {
    get read() {
      return read;
    },
    get write() {
      return write;
    },
    swap() {
      const temp = read;
      read = write;
      write = temp;
    },
    dispose() {
      gl.deleteFramebuffer(read.fbo);
      gl.deleteFramebuffer(write.fbo);
      gl.deleteTexture(read.texture);
      gl.deleteTexture(write.texture);
    },
  };
}

export function deleteFBO(gl, target) {
  if (!target) return;
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.texture);
}

export class FullscreenQuad {
  constructor(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose() {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteVertexArray(this.vao);
  }
}

export function bindTarget(gl, target, width, height) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  gl.viewport(0, 0, width, height);
}

export function clearTarget(gl, target, width, height, color = [0, 0, 0, 0]) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  gl.viewport(0, 0, width, height);
  gl.clearColor(color[0], color[1], color[2], color[3]);
  gl.clear(gl.COLOR_BUFFER_BIT);
}
