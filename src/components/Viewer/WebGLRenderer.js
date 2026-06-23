import { colormaps } from '../../lib/colorMaps'

/**
 * WebGL2 Renderer for hyperspectral band images.
 * 
 * Renders a single spectral band (or RGB composite) to a canvas
 * using GPU-accelerated texture mapping with real-time contrast adjustment.
 */

// Vertex shader — fullscreen quad
const VERT_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`

// Fragment shader — intensity mapping with min/max normalization and gamma
const FRAG_SHADER_SINGLE = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_band;
uniform sampler2D u_colormap;
uniform float u_min;
uniform float u_max;
uniform float u_gamma;

void main() {
  float value = texture(u_band, v_texCoord).r;
  
  // Normalize to [0, 1] using min/max
  float range = u_max - u_min;
  float normalized = range > 0.0 ? clamp((value - u_min) / range, 0.0, 1.0) : 0.5;
  
  // Apply gamma correction
  normalized = pow(normalized, 1.0 / u_gamma);
  
  // Lookup color from 1D colormap texture
  vec3 color = texture(u_colormap, vec2(normalized, 0.5)).rgb;
  
  fragColor = vec4(color, 1.0);
}
`

// Fragment shader for RGB composite
const FRAG_SHADER_RGB = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;

void main() {
  fragColor = texture(u_texture, v_texCoord);
}
`

function compileShader(gl, source, type) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error('Shader compile error: ' + err)
  }
  return shader
}

function createProgram(gl, vertSrc, fragSrc) {
  const vert = compileShader(gl, vertSrc, gl.VERTEX_SHADER)
  const frag = compileShader(gl, fragSrc, gl.FRAGMENT_SHADER)
  const program = gl.createProgram()
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const err = gl.getProgramInfoLog(program)
    throw new Error('Program link error: ' + err)
  }
  return program
}

export class WebGLBandRenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    })

    if (!this.gl) {
      throw new Error('WebGL2 not supported in this browser.')
    }

    const gl = this.gl

    // Check for float texture support
    const extColorBufferFloat = gl.getExtension('EXT_color_buffer_float')

    // Create shader programs
    this.singleBandProgram = createProgram(gl, VERT_SHADER, FRAG_SHADER_SINGLE)
    this.rgbProgram = createProgram(gl, VERT_SHADER, FRAG_SHADER_RGB)

    // Create fullscreen quad
    // Positions: two triangles covering clip space
    const positions = new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1,
    ])
    // Tex coords: flip Y for image coordinates (top=0)
    const texCoords = new Float32Array([
      0, 1,  1, 1,  0, 0,
      0, 0,  1, 1,  1, 0,
    ])

    // Setup VAO for single band program
    this.singleVao = gl.createVertexArray()
    gl.bindVertexArray(this.singleVao)

    const posBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    const posLoc = gl.getAttribLocation(this.singleBandProgram, 'a_position')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    const texBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuf)
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW)
    const texLoc = gl.getAttribLocation(this.singleBandProgram, 'a_texCoord')
    gl.enableVertexAttribArray(texLoc)
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0)

    gl.bindVertexArray(null)

    // Setup VAO for RGB program
    this.rgbVao = gl.createVertexArray()
    gl.bindVertexArray(this.rgbVao)

    const posBuf2 = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf2)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    const posLoc2 = gl.getAttribLocation(this.rgbProgram, 'a_position')
    gl.enableVertexAttribArray(posLoc2)
    gl.vertexAttribPointer(posLoc2, 2, gl.FLOAT, false, 0, 0)

    const texBuf2 = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuf2)
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW)
    const texLoc2 = gl.getAttribLocation(this.rgbProgram, 'a_texCoord')
    gl.enableVertexAttribArray(texLoc2)
    gl.vertexAttribPointer(texLoc2, 2, gl.FLOAT, false, 0, 0)

    gl.bindVertexArray(null)

    // Create textures
    this.bandTexture = gl.createTexture()
    this.rgbTexture = gl.createTexture()
    this.colormapTexture = gl.createTexture()

    // Initialize colormap to grayscale
    this.currentColormap = null
    this.setColormap('grayscale')

    // Get uniform locations
    this.uniforms = {
      band: gl.getUniformLocation(this.singleBandProgram, 'u_band'),
      colormap: gl.getUniformLocation(this.singleBandProgram, 'u_colormap'),
      min: gl.getUniformLocation(this.singleBandProgram, 'u_min'),
      max: gl.getUniformLocation(this.singleBandProgram, 'u_max'),
      gamma: gl.getUniformLocation(this.singleBandProgram, 'u_gamma'),
      rgbTexture: gl.getUniformLocation(this.rgbProgram, 'u_texture'),
    }

    this.width = 0
    this.height = 0
  }

  /**
   * Set the current colormap texture.
   * @param {string} colormapName 
   */
  setColormap(colormapName) {
    if (this.currentColormap === colormapName) return
    this.currentColormap = colormapName
    
    const cmapFn = colormaps[colormapName] || colormaps['grayscale']
    const lutData = new Uint8Array(256 * 3)
    for (let i = 0; i < 256; i++) {
      const color = cmapFn(i / 255.0)
      lutData[i*3] = color[0]
      lutData[i*3+1] = color[1]
      lutData[i*3+2] = color[2]
    }
    
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, lutData)
  }

  /**
   * Render a single band
   * @param {Float32Array} bandData - Raw band values
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {number} min - Min value for contrast stretch
   * @param {number} max - Max value for contrast stretch
   * @param {number} gamma - Gamma correction value (default 1.0)
   */
  renderBand(bandData, width, height, min, max, gamma = 1.0) {
    const gl = this.gl

    // Resize canvas if needed
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.width = width
      this.height = height
    }

    gl.viewport(0, 0, width, height)

    // Upload band data as R32F texture
    gl.bindTexture(gl.TEXTURE_2D, this.bandTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, bandData)

    // Draw
    gl.useProgram(this.singleBandProgram)
    gl.bindVertexArray(this.singleVao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.bandTexture)
    gl.uniform1i(this.uniforms.band, 0)
    
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture)
    gl.uniform1i(this.uniforms.colormap, 1)

    gl.uniform1f(this.uniforms.min, min)
    gl.uniform1f(this.uniforms.max, max)
    gl.uniform1f(this.uniforms.gamma, gamma)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.bindVertexArray(null)
  }

  /**
   * Render an RGB composite
   * @param {Uint8ClampedArray} rgbData - RGBA pixel data (width * height * 4)
   * @param {number} width
   * @param {number} height
   */
  renderRGB(rgbData, width, height) {
    const gl = this.gl

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      this.width = width
      this.height = height
    }

    gl.viewport(0, 0, width, height)

    gl.bindTexture(gl.TEXTURE_2D, this.rgbTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgbData)

    gl.useProgram(this.rgbProgram)
    gl.bindVertexArray(this.rgbVao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.rgbTexture)
    gl.uniform1i(this.uniforms.rgbTexture, 0)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.bindVertexArray(null)
  }

  /**
   * Clean up WebGL resources
   */
  destroy() {
    const gl = this.gl
    if (!gl) return
    gl.deleteTexture(this.bandTexture)
    gl.deleteTexture(this.rgbTexture)
    gl.deleteTexture(this.colormapTexture)
    gl.deleteProgram(this.singleBandProgram)
    gl.deleteProgram(this.rgbProgram)
    gl.deleteVertexArray(this.singleVao)
    gl.deleteVertexArray(this.rgbVao)
  }
}
