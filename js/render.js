/* WebGL renderer with a real perspective camera. Three passes per frame, all on the GPU:
   1. Background: a full-screen shader casts a ray per pixel onto a neon grid
      floor below the track (warped and colour-cycled as hard as the world asks),
      fading into a glowing horizon and sky.
   2. Glow batch: every lane, hazard, particle and the dot is a quad in one
      additive draw call. Lanes are ribbons lying on the track; orbs and blocks
      are billboards facing the camera. The fragment shader turns each quad into
      a neon tube or orb, so glow costs nothing extra.
   3. Post: the frame is resampled with lens warp, colour fringing, vignette
      and full-screen flashes.
   Looking straight down (pitch 0) gives the flat top-down view; tilting the
   pitch towards 90 degrees turns it into a chase camera. Works on WebGL2 and WebGL1. */
(function (root) {
  'use strict';

  const STRIDE = 14;   // x, y, h, u, v, r, g, b, a, core, shape, halfWidth, offX, offY
  const PERIOD = 6600; // background pattern repeat, in world units (60 grid cells)
  const NEAR = 20;     // anything closer to the camera than this is clipped

  const VS_GLOW = `
attribute vec3 a_pos;
attribute vec2 a_uv;
attribute vec4 a_col;
attribute vec3 a_par;
attribute vec2 a_off;
uniform mat4 u_vp;
uniform vec2 u_offk;
uniform float u_pxk;
varying vec2 v_uv;
varying vec4 v_col;
varying vec3 v_par;
void main() {
  vec4 p = u_vp * vec4(a_pos, 1.0);
  p.xy += a_off * u_offk;
  gl_Position = p;
  v_uv = a_uv;
  v_col = a_col;
  v_par = vec3(a_par.xy, a_par.z * u_pxk / max(p.w, 1.0));
}`;

  // shape 0 = orb, 1 = rounded square, 2 = tube (distance across the strip only)
  const FS_GLOW = `
precision mediump float;
varying vec2 v_uv;
varying vec4 v_col;
varying vec3 v_par;
void main() {
  float d;
  if (v_par.y < 0.5) d = length(v_uv);
  else if (v_par.y < 1.5) d = max(abs(v_uv.x), abs(v_uv.y));
  else d = abs(v_uv.y);
  if (d >= 1.0) discard;
  float aa = 1.5 / max(v_par.z, 1.0);
  float core = 1.0 - smoothstep(v_par.x - aa, v_par.x + aa, d);
  float halo = (1.0 - d) * (1.0 - d);
  halo *= halo;
  // Shape 3 is a tube that keeps its colour: only a hint of white in the core.
  float white = v_par.y > 2.5 ? 0.1 : 0.42;
  vec3 rgb = v_col.rgb * (halo * 0.9 + core) + vec3(core * white);
  gl_FragColor = vec4(rgb * v_col.a, 1.0);
}`;

  const VS_FULL = `
attribute vec2 a_pos;
varying vec2 v_clip;
void main() {
  v_clip = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

  const FS_BG = `
precision PRECISION float;
varying vec2 v_clip;
uniform vec3 u_cam;
uniform vec3 u_fwd;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec2 u_res;
uniform vec2 u_roll;
uniform float u_f;
uniform float u_mirror;
uniform float u_floor;
uniform float u_fog;
uniform float u_time;
uniform float u_warp;
uniform float u_trip;
uniform float u_pulse;
uniform vec3 u_lane;
uniform vec3 u_bg;
const float TAU = 6.2831853;
const float K = TAU / ${PERIOD.toFixed(1)};
void main() {
  // Undo mirror and roll to get this pixel's ray through the camera.
  float xr = v_clip.x * u_res.x * 0.5 / u_mirror;
  float yr = -v_clip.y * u_res.y * 0.5;
  float xp = u_roll.x * xr + u_roll.y * yr;
  float yp = -u_roll.y * xr + u_roll.x * yr;
  vec3 dir = u_fwd + u_right * (xp / u_f) - u_up * (yp / u_f);
  vec3 nd = normalize(dir);
  float t1 = u_time * 0.07;
  vec3 rainbowSky = 0.5 + 0.5 * cos(TAU * (vec3(0.0, 0.33, 0.67) + nd.z * 1.5 - t1));
  vec3 skyTint = mix(u_lane, rainbowSky, u_trip);
  float e = max(nd.z, 0.0);
  vec3 sky = u_bg * 1.6 + skyTint * (0.35 * exp(-e * 14.0) + 0.05 * exp(-e * 3.0));
  sky += skyTint * 0.06 * u_trip * (0.5 + 0.5 * sin(e * 60.0 - u_time * 2.0));
  vec3 col = sky;
  if (nd.z < -0.0015) {
    float t = (u_floor - u_cam.z) / dir.z;
    vec2 p = u_cam.xy + dir.xy * t;
    float dist = t * length(dir);
    float px = dist / u_f / max(0.12, -nd.z);
    vec2 q = p + u_warp * 70.0 * vec2(sin(p.y * K * 6.0 + u_time * 0.9), cos(p.x * K * 6.0 - u_time * 0.7));
    vec2 g = abs(fract(q / 110.0) - 0.5) * 110.0;
    float line = 1.0 - smoothstep(0.0, px * 1.6, min(g.x, g.y));
    float node = 1.0 - smoothstep(0.0, px * 2.5, length(g) - 2.0);
    vec3 rainbow = 0.5 + 0.5 * cos(TAU * (vec3(0.0, 0.33, 0.67) + (q.x + q.y) * K * 2.0 + u_time * 0.07));
    vec3 tint = mix(u_lane, rainbow, u_trip);
    float plasma = sin(q.x * K * 4.0 + u_time) + sin(q.y * K * 5.0 - u_time * 1.3) + sin((q.x - q.y) * K * 3.0 + u_time * 0.6);
    vec3 ground = u_bg + tint * (line * 0.095 + node * 0.16) * (1.0 + u_pulse) / (1.0 + px * 0.08);
    ground += tint * (0.5 + 0.5 * sin(plasma * 1.5)) * 0.07 * u_trip;
    col = mix(sky, ground, exp(-dist / u_fog));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

  const FS_POST = `
precision mediump float;
varying vec2 v_clip;
uniform sampler2D u_tex;
uniform float u_ca;
uniform float u_warp;
uniform float u_vig;
uniform vec4 u_flash;
void main() {
  vec2 c = v_clip * 0.5;
  float r2 = dot(c, c);
  vec2 uv = 0.5 + c * (1.0 + u_warp * (r2 - 0.25));
  vec2 off = c * u_ca;
  vec3 col = vec3(texture2D(u_tex, uv + off).r, texture2D(u_tex, uv).g, texture2D(u_tex, uv - off).b);
  col *= 1.0 - u_vig * r2;
  col = mix(col, u_flash.rgb, u_flash.a);
  gl_FragColor = vec4(col, 1.0);
}`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
    return sh;
  }

  function link(gl, vs, fs, attribs) {
    const pr = gl.createProgram();
    gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, fs));
    attribs.forEach((name, i) => gl.bindAttribLocation(pr, i, name));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || 'program link failed');
    return pr;
  }

  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function createRenderer(canvas) {
    const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
    let gl = canvas.getContext('webgl2', opts);
    const isGL2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) return null;
    const uintIdx = isGL2 || !!gl.getExtension('OES_element_index_uint');
    const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const bgPrecision = hp && hp.precision > 0 ? 'highp' : 'mediump';
    const maxVerts = uintIdx ? 1 << 22 : 65536;

    let progGlow, progBg, progPost, vbo, ibo, tri, fbo, tex;
    let texW = 0, texH = 0, gpuV = 0, gpuI = 0, lost = false;
    let cap = 16384;
    let data = new Float32Array(cap * STRIDE);
    let idx = uintIdx ? new Uint32Array(cap * 3) : new Uint16Array(cap * 3);
    let nv = 0, ni = 0;
    let ox = 0, oy = 0;
    const VP = new Float32Array(16);
    const U = {};
    const LINE = new Float32Array(6);
    // Camera state kept for the background pass.
    const BG = { cam: [0, 0, 0], fwd: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0], f: 1, w: 1, h: 1, roll: [1, 0], mirror: 1, pxk: 1, offk: [1, 1] };

    function init() {
      progGlow = link(gl, VS_GLOW, FS_GLOW, ['a_pos', 'a_uv', 'a_col', 'a_par', 'a_off']);
      progBg = link(gl, VS_FULL, FS_BG.replace('PRECISION', bgPrecision), ['a_pos']);
      progPost = link(gl, VS_FULL, FS_POST, ['a_pos']);
      for (const n of ['vp', 'offk', 'pxk']) U['g_' + n] = gl.getUniformLocation(progGlow, 'u_' + n);
      for (const n of ['cam', 'fwd', 'right', 'up', 'res', 'roll', 'f', 'mirror', 'floor', 'fog', 'time', 'warp', 'trip', 'pulse', 'lane', 'bg']) {
        U['bg_' + n] = gl.getUniformLocation(progBg, 'u_' + n);
      }
      for (const n of ['tex', 'ca', 'warp', 'vig', 'flash']) U['post_' + n] = gl.getUniformLocation(progPost, 'u_' + n);
      vbo = gl.createBuffer();
      ibo = gl.createBuffer();
      tri = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, tri);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      tex = gl.createTexture();
      fbo = gl.createFramebuffer();
      texW = texH = gpuV = gpuI = 0;
    }

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { init(); lost = false; });
    init();

    function ensureTarget(w, h) {
      if (w === texW && h === texH) return;
      texW = w; texH = h;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function room(v, i) {
      if (nv + v <= cap && ni + i <= idx.length) return true;
      if (nv + v > maxVerts) return false;
      while (cap < nv + v || cap * 3 < ni + i) cap *= 2;
      cap = Math.min(cap, maxVerts);
      const d2 = new Float32Array(cap * STRIDE);
      d2.set(data.subarray(0, nv * STRIDE));
      data = d2;
      const i2 = uintIdx ? new Uint32Array(cap * 3) : new Uint16Array(cap * 3);
      i2.set(idx.subarray(0, ni));
      idx = i2;
      return true;
    }

    function vert(x, y, h, u, v, r, g, b, a, core, shape, hw, offX, offY) {
      const o = nv * STRIDE;
      data[o] = x - ox; data[o + 1] = y - oy; data[o + 2] = h;
      data[o + 3] = u; data[o + 4] = v;
      data[o + 5] = r; data[o + 6] = g; data[o + 7] = b; data[o + 8] = a;
      data[o + 9] = core; data[o + 10] = shape; data[o + 11] = hw;
      data[o + 12] = offX; data[o + 13] = offY;
      return nv++;
    }

    const api = {
      webgl2: isGL2,

      /* cam: {x, y, h}: the world point the camera looks at (shown at screen centre);
         yaw: direction the camera faces along the ground; pitch: 0 looks straight down,
         towards PI/2 looks along the ground; roll: screen spin; mirror: 1 or -1 (or in
         between during a flip); f: focal length in CSS pixels; dist: camera distance
         from the look point; shakeX/Y in CSS pixels; cssW/cssH: canvas size. */
      begin(cam) {
        nv = ni = 0;
        ox = cam.x; oy = cam.y;
        const W = cam.cssW, H = cam.cssH, f = cam.f;
        const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
        const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
        const fwd = [cy * sp, sy * sp, -cp];
        const up = [cy * cp, sy * cp, sp];
        const right = [-sy, cy, 0];
        const C = [-fwd[0] * cam.dist, -fwd[1] * cam.dist, cam.h - fwd[2] * cam.dist];
        const Rr = [right[0], right[1], right[2], -dot3(C, right)];
        const Ur = [up[0], up[1], up[2], -dot3(C, up)];
        const Dr = [fwd[0], fwd[1], fwd[2], -dot3(C, fwd)];
        const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
        const ax = (cam.mirror * 2 * f) / W, ay = (2 * f) / H, kx = (2 * cam.shakeX) / W, ky = (2 * cam.shakeY) / H;
        for (let j = 0; j < 4; j++) {
          const r0 = ax * (cr * Rr[j] + sr * Ur[j]) + kx * Dr[j];
          const r1 = ay * (cr * Ur[j] - sr * Rr[j]) - ky * Dr[j];
          VP[j * 4] = r0;
          VP[j * 4 + 1] = r1;
          VP[j * 4 + 2] = Dr[j] - (j === 3 ? 2 * NEAR : 0);
          VP[j * 4 + 3] = Dr[j];
        }
        const pr = canvas.width / W;
        BG.cam[0] = ((ox % PERIOD) + PERIOD) % PERIOD + C[0];
        BG.cam[1] = ((oy % PERIOD) + PERIOD) % PERIOD + C[1];
        BG.cam[2] = C[2];
        BG.fwd = fwd; BG.right = right; BG.up = up;
        BG.f = f; BG.w = W; BG.h = H;
        BG.roll[0] = cr; BG.roll[1] = sr;
        BG.mirror = cam.mirror;
        BG.pxk = f * pr;
        BG.offk[0] = (2 * f) / W; BG.offk[1] = (2 * f) / H;
      },

      /* A neon tube along points [x0, y0, h0, x1, y1, h1, ...], lying on the track.
         hw: half-width of the whole glow in world units; core: bright centre as a
         fraction of hw. Alpha fades from a0 to a1, times alphas[i] when given.
         shape 2 (default) has a white-hot core; 3 keeps its colour (the lanes). */
      strip(pts, count, hw, r, g, b, a0, a1, core, alphas, shape = 2) {
        if (count < 2 || !room(count * 2, (count - 1) * 6)) return;
        const base = nv;
        for (let i = 0; i < count; i++) {
          const i0 = i > 0 ? i - 1 : i, i1 = i < count - 1 ? i + 1 : i;
          let tx = pts[i1 * 3] - pts[i0 * 3], ty = pts[i1 * 3 + 1] - pts[i0 * 3 + 1];
          const len = Math.hypot(tx, ty) || 1;
          tx /= len; ty /= len;
          const nx = -ty * hw, ny = tx * hw;
          let a = a0 + ((a1 - a0) * i) / (count - 1);
          if (alphas) a *= alphas[i];
          const x = pts[i * 3], y = pts[i * 3 + 1], h = pts[i * 3 + 2];
          vert(x + nx, y + ny, h, 0, 1, r, g, b, a, core, shape, hw, 0, 0);
          vert(x - nx, y - ny, h, 0, -1, r, g, b, a, core, shape, hw, 0, 0);
        }
        for (let i = 0; i < count - 1; i++) {
          const k = base + i * 2;
          idx[ni++] = k; idx[ni++] = k + 1; idx[ni++] = k + 2;
          idx[ni++] = k + 1; idx[ni++] = k + 3; idx[ni++] = k + 2;
        }
      },

      line(x0, y0, h0, x1, y1, h1, hw, r, g, b, a, core) {
        LINE[0] = x0; LINE[1] = y0; LINE[2] = h0; LINE[3] = x1; LINE[4] = y1; LINE[5] = h1;
        api.strip(LINE, 2, hw, r, g, b, a, a, core, null);
      },

      /* An orb (shape 0) or rounded square (shape 1) facing the camera, radius rad in
         world units, turned by rot on screen. */
      sprite(x, y, h, rad, r, g, b, a, core, shape, rot) {
        if (!room(4, 6)) return;
        const c = Math.cos(rot || 0) * rad, s = Math.sin(rot || 0) * rad;
        const base = nv;
        vert(x, y, h, -1, -1, r, g, b, a, core, shape, rad, -c + s, -s - c);
        vert(x, y, h, 1, -1, r, g, b, a, core, shape, rad, c + s, s - c);
        vert(x, y, h, 1, 1, r, g, b, a, core, shape, rad, c - s, s + c);
        vert(x, y, h, -1, 1, r, g, b, a, core, shape, rad, -c - s, -s + c);
        idx[ni++] = base; idx[ni++] = base + 1; idx[ni++] = base + 2;
        idx[ni++] = base; idx[ni++] = base + 2; idx[ni++] = base + 3;
      },

      /* fx: {time, lane:[r,g,b], bg:[r,g,b], warp, trip, pulse, floor, fog, ca, lens, vig, flash:[r,g,b,a]} */
      end(fx) {
        if (lost || gl.isContextLost()) return;
        const w = canvas.width, h = canvas.height;
        ensureTarget(w, h);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, w, h);
        gl.disable(gl.BLEND);

        gl.useProgram(progBg);
        gl.uniform3f(U.bg_cam, BG.cam[0], BG.cam[1], BG.cam[2]);
        gl.uniform3f(U.bg_fwd, BG.fwd[0], BG.fwd[1], BG.fwd[2]);
        gl.uniform3f(U.bg_right, BG.right[0], BG.right[1], BG.right[2]);
        gl.uniform3f(U.bg_up, BG.up[0], BG.up[1], BG.up[2]);
        gl.uniform2f(U.bg_res, BG.w, BG.h);
        gl.uniform2f(U.bg_roll, BG.roll[0], BG.roll[1]);
        gl.uniform1f(U.bg_f, BG.f);
        gl.uniform1f(U.bg_mirror, BG.mirror);
        gl.uniform1f(U.bg_floor, fx.floor);
        gl.uniform1f(U.bg_fog, fx.fog);
        gl.uniform1f(U.bg_time, fx.time);
        gl.uniform1f(U.bg_warp, fx.warp);
        gl.uniform1f(U.bg_trip, fx.trip);
        gl.uniform1f(U.bg_pulse, fx.pulse);
        gl.uniform3f(U.bg_lane, fx.lane[0], fx.lane[1], fx.lane[2]);
        gl.uniform3f(U.bg_bg, fx.bg[0], fx.bg[1], fx.bg[2]);
        gl.bindBuffer(gl.ARRAY_BUFFER, tri);
        gl.enableVertexAttribArray(0);
        for (let i = 1; i < 5; i++) gl.disableVertexAttribArray(i);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        if (ni) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(progGlow);
          gl.uniformMatrix4fv(U.g_vp, false, VP);
          gl.uniform2f(U.g_offk, BG.offk[0], BG.offk[1]);
          gl.uniform1f(U.g_pxk, BG.pxk);
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          const bytesV = nv * STRIDE * 4;
          if (bytesV > gpuV) { gpuV = data.byteLength; gl.bufferData(gl.ARRAY_BUFFER, gpuV, gl.DYNAMIC_DRAW); }
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, nv * STRIDE));
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
          const bytesI = ni * idx.BYTES_PER_ELEMENT;
          if (bytesI > gpuI) { gpuI = idx.byteLength; gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gpuI, gl.DYNAMIC_DRAW); }
          gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, idx.subarray(0, ni));
          const B = STRIDE * 4;
          for (let i = 0; i < 5; i++) gl.enableVertexAttribArray(i);
          gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
          gl.vertexAttribPointer(1, 2, gl.FLOAT, false, B, 12);
          gl.vertexAttribPointer(2, 4, gl.FLOAT, false, B, 20);
          gl.vertexAttribPointer(3, 3, gl.FLOAT, false, B, 36);
          gl.vertexAttribPointer(4, 2, gl.FLOAT, false, B, 48);
          gl.drawElements(gl.TRIANGLES, ni, uintIdx ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
          gl.disable(gl.BLEND);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.useProgram(progPost);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(U.post_tex, 0);
        gl.uniform1f(U.post_ca, fx.ca);
        gl.uniform1f(U.post_warp, fx.lens);
        gl.uniform1f(U.post_vig, fx.vig);
        gl.uniform4f(U.post_flash, fx.flash[0], fx.flash[1], fx.flash[2], fx.flash[3]);
        gl.bindBuffer(gl.ARRAY_BUFFER, tri);
        gl.enableVertexAttribArray(0);
        for (let i = 1; i < 5; i++) gl.disableVertexAttribArray(i);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
    return api;
  }

  root.WHGRender = { create: createRenderer };
})(window);
