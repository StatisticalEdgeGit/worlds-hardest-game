/* World's Hardest Game: game flow for both modes, input, saved stats, lane
   colours and colour cues, VEX's chat bubble, seamless level hand-overs, and
   drawing through the WebGL renderer in js/render.js. */
(function () {
  'use strict';

  const G = window.WHG;
  const V = window.VEX;
  const C = window.WHGCues;
  const O = window.WHGOnline;
  const RC = window.WHGRace;
  // VEX's messages during play are off for now: they were too much to read while hopping,
  // so the colour cues (js/cues.js) do the guiding. Menu screens still show a VEX line.
  const VEX_IN_PLAY = false;
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (x) => x * x * (3 - 2 * x);
  const UNITS_PER_METRE = 20;

  /* ---------- colours (0..1) ---------- */

  const DOT = [1, 0.31, 0.85];
  const LASER = [1, 0.23, 0.36];
  const SWEEP = [1, 0.72, 0.17];
  const FINISH = [0.78, 1, 0.35];
  const WHITE = [1, 1, 1];

  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
  }
  const cssColor = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

  function makePalette(w) {
    const { hue, sat } = G.WORLDS[w];
    return { lane: hsl(hue, sat, 62), bg: hsl(hue, sat * 0.5, 3.5) };
  }

  /* ---------- saved progress ---------- */

  const STATS_KEY = 'whg.stats.v1';
  const RUN_KEYS = { survival: 'whg.run.v2', marathon: 'whg.marathon.v1' };

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage blocked: progress lasts for this visit only */ }
  }

  const stats = Object.assign({
    highest: 0, runs: 0, wins: 0, clears: 0, deaths: 0, falls: 0, hits: 0,
    metres: 0, deadLifeMetres: 0, longestLife: 0, bestRun: 0, hops: 0,
    playTime: 0, bestTime: null, levels: {},
    mRuns: 0, mFinishes: 0, mBest: null, mFurthest: 0, mFurthestUsed: 0,
  }, readJSON(STATS_KEY) || {});
  if (!stats.levels || typeof stats.levels !== 'object') stats.levels = {};
  const saveStats = () => writeJSON(STATS_KEY, stats);

  /* Per level, all time: [attempts, deaths, clears]. */
  const levelStat = (n) => stats.levels[n] || (stats.levels[n] = [0, 0, 0]);
  const avgLife = () => (stats.deaths ? stats.deadLifeMetres / stats.deaths : 0);
  function nemesis() {
    let n = 0, d = 0;
    for (const k in stats.levels) if (stats.levels[k][1] > d) { d = stats.levels[k][1]; n = +k; }
    return n ? { n, deaths: d } : null;
  }

  function readRun(game) {
    const r = readJSON(RUN_KEYS[game]);
    if (!r || !(r.level >= 1 && r.level <= G.LEVEL_COUNT)) return null;
    if (game === 'survival' && !(r.lives >= 1 && r.lives <= 3)) return null;
    return {
      level: r.level | 0, lives: game === 'survival' ? r.lives | 0 : 0, used: Math.max(0, r.used | 0),
      metres: +r.metres || 0, life: +r.life || 0, time: +r.time || 0, said: Array.isArray(r.said) ? r.said : [],
      runId: typeof r.runId === 'string' ? r.runId : null,
    };
  }

  const fmtDist = V.fmtDist;
  function fmtTime(sec) {
    sec = Math.max(0, sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  const plural = (n, one, many) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

  /* ---------- levels, built in a background thread ---------- */

  const store = (() => {
    const cache = new Map(), waiting = new Map();
    let worker = null;
    function put(n, lv) {
      cache.set(n, lv);
      while (cache.size > 8) cache.delete(cache.keys().next().value);
    }
    function finish(n, lv) {
      put(n, lv);
      const cbs = waiting.get(n) || [];
      waiting.delete(n);
      for (const cb of cbs) cb(lv);
    }
    function fallback() {
      worker = null;
      for (const n of [...waiting.keys()]) finish(n, G.generateLevel(n));
    }
    try {
      worker = new Worker('js/level-worker.js');
      worker.onmessage = (e) => finish(e.data.n, e.data.lv || G.generateLevel(e.data.n));
      worker.onerror = (e) => { if (e.preventDefault) e.preventDefault(); fallback(); };
    } catch (e) { worker = null; }
    return {
      get(n) {
        const lv = cache.get(n);
        if (lv) { cache.delete(n); cache.set(n, lv); }
        return lv;
      },
      /* Returns the level now, building it on this thread if the worker hasn't delivered it. */
      now(n) {
        let lv = this.get(n);
        if (!lv) { lv = G.generateLevel(n); put(n, lv); }
        return lv;
      },
      load(n, cb) {
        if (cache.has(n)) { if (cb) cb(cache.get(n)); return; }
        if (waiting.has(n)) { if (cb) waiting.get(n).push(cb); return; }
        waiting.set(n, cb ? [cb] : []);
        if (worker) worker.postMessage({ n });
        else setTimeout(() => finish(n, G.generateLevel(n)), 0);
      },
    };
  })();

  /* ---------- canvas and renderer ---------- */

  const canvas = $('game');
  const R = window.WHGRender.create(canvas);
  let W = 1, H = 1, safeTop = 0, quality = 1, emaDt = 1 / 60, lastQ = 0;

  function resize() {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const maxPr = Math.sqrt(3.2e6 / (W * H));   // keep each frame under ~3.2 megapixels
    const pr = Math.max(0.5, Math.min(dpr * quality, maxPr));
    canvas.width = Math.round(W * pr);
    canvas.height = Math.round(H * pr);
    // The HUD's top padding is the notch inset + 10px, already resolved to pixels.
    safeTop = Math.max(0, (parseFloat(getComputedStyle($('hud')).paddingTop) || 10) - 10);
  }

  /* Drops resolution when frames run long, and creeps back up when they're quick. */
  function adaptQuality(dt, now) {
    if (dt <= 0 || dt > 0.1) return;
    emaDt += (dt - emaDt) * 0.05;
    if (now - lastQ < 1500) return;
    if (emaDt > 1 / 50 && quality > 0.5) { quality = Math.max(0.5, quality * 0.8); lastQ = now; resize(); }
    else if (emaDt < 1 / 58 && quality < 1 && now - lastQ > 5000) { quality = Math.min(1, quality * 1.15); lastQ = now; resize(); }
  }

  /* ---------- state ---------- */

  const S = {
    mode: 'title',          // title | loading | play | dying | clear | paused | over | win | stats
    game: 'survival',       // survival | marathon
    level: 1, lives: 3, used: 0, runTime: 0, runMetres: 0, lifeMetres: 0, lastLifeM: 0, highestBefore: 0,
    lv: null, p: null, timer: 0, hold: 0, deathClock: 0, attempt: 0, bannerUntil: 0,
    prev: null,             // the level just finished, still drawn behind you: {lv, xf, t0}
    camBlend: null,         // eases the camera from the old level's view into the new one
    slide: null,            // eases the dot sideways onto the new level's lane
    pendingReason: 'start', vexItems: [], vexOverride: null, toldForks: new Set(), menuBack: 'title',
    ranked: null,           // the leaderboard server's view of this run, when it's ranked
    syncNext: false,        // after continuing a ranked run, take the server's word on lives once
    inputs: [], log: [], lane0: 0, acc: 0,   // hops waiting for the next tick, and this attempt's hop log
    nameAsked: false, boardsBack: 'title', board: 'survival',
    race: null,             // the race you're in (lobby, racing or results), if any
    attract: null, attractI: 0,
  };
  const MENU = { title: 1, over: 1, win: 1, stats: 1, name: 1, boards: 1, lobby: 1, join: 1, raceEnd: 1 };
  const PAL = { lane: [0.2, 0.9, 1], bg: [0.01, 0.02, 0.03] };
  let palTarget = makePalette(0);

  const cam = {
    x: 0, y: 0, z: 1, off: 0, alpha: 0, mirror: 1, px: 0, py: 0, pz: 0, shake: 0, kick: 0, reversed: false,
    tilt: 0, h: 0, yaw: -Math.PI / 2, roll: 0, pitch: 0, f: 1600, dist: 1600, lookAhead: 0,
  };
  const CS = { rot: 0, mirror: 1, zoom: 1, head: 0, tilt: 0 };
  const FX = { time: 0, lane: PAL.lane, bg: PAL.bg, warp: 0, trip: 0, pulse: 0, floor: -170, fog: 1e7, ca: 0, lens: 0, vig: 0.95, flash: [0, 0, 0, 0] };
  const Q = { x: 0, y: 0, th: 0 };
  const Q2 = { x: 0, y: 0, th: 0 };
  const TA = { x: 0, y: 0, th: 0 };
  const TB = { x: 0, y: 0, th: 0 };
  const SEG = [0, 0, 0, 0];
  const trail = [];
  const particles = [];
  let snapCam = true;
  let XF = null;            // transform applied while drawing the previous level

  /* ---------- level-to-level transform ---------- */

  /* Rigid move that puts the old level's finish line on the new level's start line. */
  function makeXf(fromLv, toLv) {
    G.trackPoint(fromLv, fromLv.length, TA);
    G.trackPoint(toLv, 0, TB);
    const phi = TB.th - TA.th;
    return { c: Math.cos(phi), s: Math.sin(phi), ax: TA.x, ay: TA.y, bx: TB.x, by: TB.y, phi };
  }
  function applyXf(xf, P) {
    const dx = P.x - xf.ax, dy = P.y - xf.ay;
    P.x = xf.bx + xf.c * dx - xf.s * dy;
    P.y = xf.by + xf.s * dx + xf.c * dy;
    P.th += xf.phi;
  }
  function place(lv, s, u, out) {
    G.place(lv, s, u, out);
    if (XF) applyXf(XF, out);
    return out;
  }

  /* ---------- camera ---------- */

  const wrapAngle = (d) => d - Math.PI * 2 * Math.round(d / (Math.PI * 2));

  /* The camera is worked out in two layers. The flat layer (zoom, how far ahead
     to look, spins, mirror flips) is the same top-down framing as always. The 3D
     layer then tilts it: pitch 0 looks straight down, higher tilt pulls the
     camera down behind the dot into a chase view that rides over the hills. */
  function updateCamera(lv, p, dt, live) {
    G.camAt(lv, p.s, CS);
    const th = G.headingAt(lv, p.s);
    let yaw = CS.head, roll = CS.rot, mirror = CS.mirror;
    if (live && S.camBlend) {
      const b = S.camBlend;
      b.k = Math.min(1, b.k + dt / 1.1);
      const e = smooth(b.k);
      yaw = b.yaw + wrapAngle(yaw - b.yaw) * e;
      roll = b.roll + wrapAngle(roll - b.roll) * e;
      mirror = b.mirror + (mirror - b.mirror) * e;
      if (b.k >= 1) S.camBlend = null;
    }
    const alpha = -Math.PI / 2 - yaw + roll;
    const msign = mirror < 0 ? -1 : 1;
    // Travel direction on screen, used to keep the most room ahead of the dot.
    const vx = Math.cos(th + alpha) * msign, vy = Math.sin(th + alpha);
    const hudTop = 84 + safeTop;
    const ex = Math.abs(vx) > 1e-3 ? (W / 2 - 12) / Math.abs(vx) : 1e9;
    const ey = Math.abs(vy) > 1e-3 ? (vy < 0 ? H / 2 - hudTop : H / 2 - 40) / Math.abs(vy) : 1e9;
    const E = Math.max(60, Math.min(ex, ey));
    const across = Math.abs(vy) * W + Math.abs(vx) * H;
    let span = 0;
    for (let ds = 0; ds <= 500; ds += 250) {
      const s2 = p.s + ds;
      span = Math.max(span, G.laneU(lv, lv.lanes - 1 + 0.8, s2, p.t) - G.laneU(lv, -0.8, s2, p.t));
    }
    const zFit = (across - 32) / span;
    const zLook = (1.42 * E) / (G.speedAt(lv, p.s) * 1.4);
    const zT = clamp(Math.min(zFit, zLook, 1.35) * CS.zoom, 0.36, 1.6);
    const offT = 0.42 * E;
    const hDot = G.heightAt(lv, p.s);
    if (snapCam) {
      cam.z = zT; cam.off = offT; cam.tilt = CS.tilt; cam.h = hDot;
      snapCam = false;
    } else {
      const k = 1 - Math.exp(-dt * 5);
      cam.z += (zT - cam.z) * k;
      cam.off += (offT - cam.off) * k;
      cam.tilt += (CS.tilt - cam.tilt) * (1 - Math.exp(-dt * 2.5));
      cam.h += (hDot - cam.h) * (1 - Math.exp(-dt * 7));
    }
    let u = G.laneU(lv, p.l, p.s, p.t);
    if (live && S.slide) {
      S.slide.k = Math.min(1, S.slide.k + dt / 0.3);
      u += S.slide.u * (1 - smooth(S.slide.k));
      if (S.slide.k >= 1) S.slide = null;
    }
    G.place(lv, p.s, u, Q);
    cam.px = Q.x; cam.py = Q.y; cam.pz = hDot + 5;
    cam.pitch = cam.tilt * 1.25;          // up to about 70 degrees
    cam.f = 1600 - 980 * cam.tilt;        // shorter focal length: lower, wider, more dramatic
    cam.dist = cam.f / cam.z;
    // Put the dot cam.off pixels from the screen centre, whatever the tilt: the ground
    // distance behind the look point that projects to that many pixels.
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    cam.lookAhead = (cam.off / cam.z) / (cp + (cam.off / cam.f) * sp);
    G.place(lv, p.s, u * 0.3 + G.laneU(lv, (lv.lanes - 1) / 2, p.s, p.t) * 0.7, Q);
    cam.x = Q.x + Math.cos(th) * cam.lookAhead;
    cam.y = Q.y + Math.sin(th) * cam.lookAhead;
    cam.alpha = alpha;
    cam.yaw = yaw;
    cam.roll = roll;
    cam.mirror = Math.abs(mirror) < 0.03 ? 0.03 * msign : mirror;
    // The dot's left on screen; if it points right, the buttons feel reversed.
    cam.reversed = Math.cos(th - Math.PI / 2 + alpha) * msign > 0.35;
  }

  /* What you can see along the track ahead: hidden behind the crest of a hill,
     and fading into haze. Worked out once per frame, looked up by distance. */
  const VIS_STEP = 16;
  const VIS = new Float32Array(2048);
  let visS0 = 0, visN = 0, visOn = false, fogFar = 1e9;

  function computeVisibility(lv, p, sB) {
    const haze = lv.view ? lv.view.haze : 0;
    const speed = G.speedAt(lv, p.s);
    const fogNear = speed * (6 - 5 * haze);
    fogFar = fogNear + speed * (3 - 2.1 * haze);
    visOn = cam.tilt > 0.02 || haze > 0;
    if (!visOn) return;
    const sCam = p.s + cam.lookAhead - cam.dist * Math.sin(cam.pitch);
    const camZ = cam.h + cam.dist * Math.cos(cam.pitch);
    visS0 = p.s - 60;
    visN = Math.min(VIS.length, Math.ceil((sB - visS0) / VIS_STEP) + 2);
    let crest = -Infinity;
    for (let s = Math.max(sCam + 80, 0); s < visS0; s += VIS_STEP) crest = Math.max(crest, (G.heightAt(lv, s) - camZ) / (s - sCam));
    for (let i = 0; i < visN; i++) {
      const s = visS0 + i * VIS_STEP, d = s - sCam;
      let v = 1;
      if (d > 80 && cam.tilt > 0.02) {
        const slope = (G.heightAt(lv, s) + 3 - camZ) / d;
        v = clamp((slope - crest) / 0.015 + 1, 0, 1);   // fully hidden a little below the crest line
        if (slope > crest) crest = slope;
      }
      const ahead = s - p.s;
      if (ahead > fogNear) v *= 1 - smooth(clamp((ahead - fogNear) / (fogFar - fogNear), 0, 1));
      VIS[i] = v;
    }
  }

  function visAt(s) {
    if (!visOn || XF) return 1;
    const f = (s - visS0) / VIS_STEP;
    if (f <= 0) return 1;
    if (f >= visN - 1) return VIS[visN - 1];
    const i = f | 0;
    return VIS[i] + (VIS[i + 1] - VIS[i]) * (f - i);
  }

  /* ---------- drawing ---------- */

  const PTS = new Float32Array(3 * 8192);
  const ALPHA = new Float32Array(8192);

  function lanePath(lv, x, a, b, t, step) {
    let n = 0;
    for (let s = a; ; s += step) {
      const ss = s > b ? b : s;
      place(lv, ss, G.laneU(lv, x, ss, t), Q);
      PTS[n * 3] = Q.x; PTS[n * 3 + 1] = Q.y; PTS[n * 3 + 2] = G.heightAt(lv, ss);
      ALPHA[n] = visAt(ss);
      n++;
      if (ss >= b || n >= ALPHA.length - 1) break;
    }
    return n;
  }

  function endBar(lv, x, s, t, c) {
    const a = visAt(s);
    if (a < 0.02) return;
    const u = G.laneU(lv, x, s, t), h = G.heightAt(lv, s);
    place(lv, s, u - 9, Q);
    place(lv, s, u + 9, Q2);
    R.line(Q.x, Q.y, h, Q2.x, Q2.y, h, 4, c[0], c[1], c[2], a, 0.5);
  }

  /* Every lane in its own colour. The lane a cue is calling for glows: steadily while
     you get ready, pulsing once it's time to hop. */
  function drawLanes(lv, t, sA, sB, cur, cue) {
    const step = clamp(12 / cam.z, 8, 40);
    const go = cue ? cue.go : false, beat = 0.5 + 0.5 * Math.sin(FX.time * Math.PI * 2 * 3.2);
    for (let x = 0; x < lv.lanes; x++) {
      const c = C.color(x), isCur = x === cur, isCue = cue && x === cue.lane;
      let a = isCur ? 1.15 : 0.85, w = isCur ? 11 : 9, core = isCur ? 0.2 : 0.17;
      if (isCue) {
        // Wider rather than brighter, so the colour doesn't wash out towards white.
        a = go ? 1.05 + 0.2 * beat : 1.15;
        w = go ? 14 + 7 * beat : 16;
        core = 0.24;
      }
      for (const iv of lv.laneIv[x]) {
        const s0 = Math.max(iv[0], sA), s1 = Math.min(iv[1], sB);
        if (s1 <= s0) continue;
        R.strip(PTS, lanePath(lv, x, s0, s1, t, step), w, c[0], c[1], c[2], a, a, core, ALPHA, 3);
        if (iv[0] >= sA) endBar(lv, x, iv[0], t, c);
        if (iv[1] <= sB && iv[1] < lv.length) endBar(lv, x, iv[1], t, c);
      }
    }
  }

  function drawDeadEnds(lv, t, sA, sB) {
    for (const de of lv.deadEnds) {
      if (de.s < sA || de.s > sB) continue;
      const a = visAt(de.s), h = G.heightAt(lv, de.s);
      place(lv, de.s, G.laneU(lv, de.l0 - 0.45, de.s, t), Q);
      place(lv, de.s, G.laneU(lv, de.l1 + 0.45, de.s, t), Q2);
      R.line(Q.x, Q.y, h, Q2.x, Q2.y, h, 8, LASER[0], LASER[1], LASER[2], 0.9 * a, 0.3);
    }
  }

  function drawFinish(lv, t, sA, sB) {
    const s = lv.length;
    if (s < sA || s > sB + 1) return;
    const u0 = G.laneU(lv, -0.9, s, t), u1 = G.laneU(lv, lv.lanes - 1 + 0.9, s, t);
    const segs = 12, a = visAt(s), h = G.heightAt(lv, s);
    for (let i = 0; i < segs; i++) {
      place(lv, s, u0 + ((u1 - u0) * i) / segs, Q);
      place(lv, s, u0 + ((u1 - u0) * (i + 1)) / segs, Q2);
      const c = i % 2 ? WHITE : FINISH;
      R.line(Q.x, Q.y, h, Q2.x, Q2.y, h, 9, c[0], c[1], c[2], (i % 2 ? 0.55 : 1) * a, 0.5);
    }
  }

  function drawLaser(lv, h, t, a) {
    const z = G.heightAt(lv, h.s) + 3;
    place(lv, h.s, G.laneU(lv, h.a - 0.5, h.s, t) + 4, Q);
    place(lv, h.s, G.laneU(lv, h.b + 0.5, h.s, t) - 4, Q2);
    if (G.laserOn(h, t)) R.line(Q.x, Q.y, z, Q2.x, Q2.y, z, h.period === 0 ? 10 : 9, LASER[0], LASER[1], LASER[2], 1.25 * a, 0.28);
    else if (G.laserWarning(h, t, 0.35)) R.line(Q.x, Q.y, z, Q2.x, Q2.y, z, 6, LASER[0], LASER[1], LASER[2], (0.25 + 0.45 * Math.random()) * a, 0.22);
    else R.line(Q.x, Q.y, z, Q2.x, Q2.y, z, 5, LASER[0], LASER[1], LASER[2], 0.16 * a, 0.2);
    R.sprite(Q.x, Q.y, z, 7, LASER[0], LASER[1], LASER[2], a, 0.42, 0, 0);
    R.sprite(Q2.x, Q2.y, z, 7, LASER[0], LASER[1], LASER[2], a, 0.42, 0, 0);
  }

  function drawSweeper(lv, h, t, a) {
    const z = G.heightAt(lv, h.s) + 4;
    G.sweeperEnds(lv, h, t, SEG);
    place(lv, SEG[0], SEG[1], Q); PTS[0] = Q.x; PTS[1] = Q.y; PTS[2] = z;
    place(lv, h.s, G.laneU(lv, h.l, h.s, t), Q); PTS[3] = Q.x; PTS[4] = Q.y; PTS[5] = z;
    const px = Q.x, py = Q.y;
    place(lv, SEG[2], SEG[3], Q); PTS[6] = Q.x; PTS[7] = Q.y; PTS[8] = z;
    R.strip(PTS, 3, 12, SWEEP[0], SWEEP[1], SWEEP[2], 1.15 * a, 1.15 * a, 0.42, null);
    R.sprite(px, py, z, 10, SWEEP[0], SWEEP[1], SWEEP[2], a, 0.5, 0, 0);
  }

  function drawSlider(lv, h, t, a) {
    const z = G.heightAt(lv, h.s) + 4;
    place(lv, h.s, G.laneU(lv, h.l - h.amp, h.s, t), Q);
    place(lv, h.s, G.laneU(lv, h.l + h.amp, h.s, t), Q2);
    R.line(Q.x, Q.y, z, Q2.x, Q2.y, z, 4, SWEEP[0], SWEEP[1], SWEEP[2], 0.14 * a, 0.3);
    place(lv, h.s, G.laneU(lv, G.sliderLane(h, t), h.s, t), Q);
    R.sprite(Q.x, Q.y, z + 6, G.SLIDER_R / 0.6, SWEEP[0], SWEEP[1], SWEEP[2], 1.1 * a, 0.6, 1, Q.th + cam.alpha);
  }

  function drawHazards(lv, t, sA, sB) {
    const hz = lv.hazards;
    for (let i = G.firstHazardFrom(lv, sA - 120); i < hz.length && hz[i].s <= sB + 120; i++) {
      const h = hz[i];
      if (h.s < sA - 120) continue;
      const a = visAt(h.s);
      if (a < 0.02) continue;
      if (h.type === 'laser') drawLaser(lv, h, t, a);
      else if (h.type === 'sweeper') drawSweeper(lv, h, t, a);
      else drawSlider(lv, h, t, a);
    }
  }

  function drawLevel(lv, t, sA, sB, cur, cue) {
    drawLanes(lv, t, sA, sB, cur, cue);
    drawDeadEnds(lv, t, sA, sB);
    drawFinish(lv, t, sA, sB);
    drawHazards(lv, t, sA, Math.min(sB, lv.length + 40));
  }

  function drawPlayer(p) {
    if (p.dead === 'hit') return;
    let scale = 1;
    if (p.dead === 'fall') scale = Math.max(0, 1 - S.deathClock / 0.45);
    if (scale <= 0) return;
    if (!p.dead && p.t > 0) {
      trail.push(cam.px, cam.py, cam.pz);
      if (trail.length > 54) trail.splice(0, 3);
    }
    if (trail.length >= 6) {
      PTS.set(trail);
      R.strip(PTS, trail.length / 3, 8, DOT[0], DOT[1], DOT[2], 0, 0.6 * scale, 0.3, null);
    }
    const hopK = p.hop >= 0 ? Math.sin(Math.PI * p.hop) : 0;
    const r = G.PLAYER_R * (1 + 0.45 * hopK) * scale;
    const z = cam.pz + hopK * 14;
    R.sprite(cam.px, cam.py, z, r * 5, DOT[0], DOT[1], DOT[2], 0.7, -1, 0, 0);
    R.sprite(cam.px, cam.py, z, r / 0.5, DOT[0], DOT[1], DOT[2], 1.3, 0.5, 0, 0);
    R.sprite(cam.px, cam.py, z, r * 0.55, 1, 1, 1, 0.8, 0.6, 0, 0);
  }

  function burst(x, y, z, count, c, power) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random()) * power;
      particles.push({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: (Math.random() - 0.3) * power * 0.5, life: 0, max: 0.5 + Math.random() * 0.6, c, r: 2 + Math.random() * 3 });
    }
  }

  function drawParticles(dt) {
    const drag = Math.pow(0.04, dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life += dt;
      if (q.life >= q.max) { particles.splice(i, 1); continue; }
      q.vx *= drag; q.vy *= drag; q.vz *= drag;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      R.sprite(q.x, q.y, q.z, q.r * 3.2, q.c[0], q.c[1], q.c[2], 1 - q.life / q.max, 0.25, 0, 0);
    }
  }

  function flash(c, a) {
    FX.flash[0] = c[0]; FX.flash[1] = c[1]; FX.flash[2] = c[2]; FX.flash[3] = a;
  }

  /* Background and screen effects. Later worlds trip harder; surges and deaths kick it up. */
  function updateFx(view, dt, now) {
    const lv = view && view.lv, p = view && view.p;
    const k = 1 - Math.exp(-dt * 2.5);
    for (let i = 0; i < 3; i++) {
      PAL.lane[i] += (palTarget.lane[i] - PAL.lane[i]) * k;
      PAL.bg[i] += (palTarget.bg[i] - PAL.bg[i]) * k;
    }
    const w = lv ? lv.world : 0;
    const trip = clamp((w - 2) / 7, 0, 1);
    let surge = 0, v = 0;
    if (lv) {
      v = G.speedAt(lv, p.s);
      const base = lv.speed * (1 + lv.speedProfile.ramp * clamp(p.s / lv.length, 0, 1));
      surge = clamp((v / base - 1) * 3, 0, 1);
    }
    FX.time = now / 1000;
    FX.warp = 0.08 + 0.55 * trip + 0.4 * surge;
    FX.trip = 0.85 * trip;
    const beat = Math.pow(0.5 + 0.5 * Math.sin(FX.time * Math.PI * 2 * (v / 320)), 6);
    FX.pulse = beat * (0.25 + 0.6 * trip) + surge * 0.6;
    FX.ca = 0.0025 + 0.004 * trip + 0.012 * surge + 0.03 * cam.kick;
    FX.lens = (0.03 + 0.08 * trip) * Math.sin(FX.time * 0.7) + 0.12 * surge + 0.12 * cam.kick;
    FX.flash[3] = Math.max(0, FX.flash[3] - dt * 2.6);
    // The grid floor sits below the lowest valley; haze swallows it in the distance.
    const hills = lv && lv.view && lv.view.hills;
    FX.floor = -((hills ? hills.a : 0) + 170);
    FX.fog = Math.min(1e7, cam.dist + fogFar * 1.2 + (cam.tilt < 0.02 ? 1e6 : 0));
    cam.kick = Math.max(0, cam.kick - dt * 2.2);
  }

  function render(view, dt) {
    if (!R) return;
    if (!view || !view.lv) {
      R.begin({ x: 0, y: 0, h: 0, yaw: -Math.PI / 2, pitch: 0, roll: 0, mirror: 1, f: 1600, dist: 1600, shakeX: 0, shakeY: 0, cssW: W, cssH: H });
      R.end(FX);
      return;
    }
    const { lv, p } = view;
    let sx = 0, sy = 0;
    if (cam.shake > 0) {
      sx = (Math.random() * 2 - 1) * cam.shake * 14;
      sy = (Math.random() * 2 - 1) * cam.shake * 14;
    }
    R.begin({
      x: cam.x, y: cam.y, h: cam.h, yaw: cam.yaw, pitch: cam.pitch, roll: cam.roll, mirror: cam.mirror,
      f: cam.f, dist: cam.dist, shakeX: sx, shakeY: sy, cssW: W, cssH: H,
    });
    const reach = Math.hypot(W, H) / 2 / cam.z;
    let sA = Math.max(-1400, p.s - reach * 1.15 - 60);
    let sB = p.s + (reach * 2.2 + 120) * (1 + 2.5 * cam.tilt);
    computeVisibility(lv, p, sB);
    if (visOn) sB = Math.min(sB, p.s + fogFar + 60);
    const prev = view === S ? S.prev : null;
    if (prev) {
      // The level you just finished, still behind you, joined at its finish line.
      const back = reach * 1.3 - p.s;
      if (back <= 0) S.prev = null;
      else {
        XF = prev.xf;
        drawLevel(prev.lv, prev.t0 + p.t, prev.lv.length - back, prev.lv.length, -1);
        XF = null;
        sA = Math.max(sA, 0);
      }
    }
    drawLevel(lv, p.t, sA, sB, p.dead ? -1 : Math.round(p.l), view === S ? cueNow : null);
    if (view === S && S.game === 'race' && S.race) drawRivals(lv, p, sA, sB);
    drawPlayer(p);
    drawParticles(dt);
    R.end(FX);
  }

  /* ---------- HUD, banner, VEX ---------- */

  const hud = $('hud');
  const hudLevel = $('hudLevel');
  const hudWorld = $('hudWorld');
  const hudDist = $('hudDist');
  const hudLives = $('hudLives');
  const hudUsed = $('hudUsed');
  const lifeDots = Array.from(document.querySelectorAll('#hudLives i'));
  const progressFill = $('progressFill');
  const badge = $('badge');
  const pads = $('pads');
  const banner = $('banner');
  const vexEl = $('vex');
  const vexShown = $('vexShown');
  const vexRest = $('vexRest');
  const vexTimer = $('vexTimer');
  const vexLive = $('vexLive');
  let shownDist = '';

  function renderHud() {
    hudLevel.textContent = S.level;
    hudWorld.textContent = S.lv ? S.lv.name : '';
    const marathon = S.game !== 'survival';
    hudLives.hidden = marathon;
    hudUsed.hidden = !marathon;
    $('hudUsedLabel').textContent = S.game === 'race' ? 'deaths' : 'lives used';
    $('raceBar').hidden = S.game !== 'race';
    if (marathon) {
      $('hudUsedN').textContent = S.used.toLocaleString('en-GB');
    } else {
      lifeDots.forEach((el, i) => el.classList.toggle('lost', i >= S.lives));
      hudLives.setAttribute('aria-label', `${plural(S.lives, 'life', 'lives')} left`);
    }
  }

  function runDistanceNow() {
    const live = (S.mode === 'play' || S.mode === 'paused') && S.p ? Math.min(S.p.s, S.lv.length) / UNITS_PER_METRE : 0;
    return S.runMetres + live;
  }

  function tickHud() {
    const d = fmtDist(runDistanceNow());
    if (d !== shownDist) { hudDist.textContent = d; shownDist = d; }
    progressFill.style.transform = `scaleX(${clamp(S.p.s / S.lv.length, 0, 1)})`;
    const rev = cam.reversed && (S.mode === 'play' || S.mode === 'paused');
    if (badge.hidden === rev) badge.hidden = !rev;
    if (S.game === 'race' && S.race) updateRaceBar(performance.now());
  }

  function showBanner(eyebrow, title, until) {
    $('bannerEyebrow').textContent = eyebrow;
    $('bannerTitle').textContent = title;
    banner.classList.add('show');
    S.bannerUntil = until == null ? -0.25 : until;
  }
  const hideBanner = () => banner.classList.remove('show');

  /* VEX's chat bubble: "typing…" dots, then the words type in at a fixed speed into a
     bubble already sized for the whole message, with a bar draining as its time runs out. */
  let vexItem = null, vexTyped = -1, vexBar = -1;
  function showVex(item, elapsed, dur) {
    if (item !== vexItem) {
      vexItem = item;
      vexTyped = vexBar = -1;
      if (!item) { vexEl.classList.remove('show'); return; }
      V.markSaid(item.text);
      if (item.fork >= 0) S.toldForks.add(item.fork);
      vexEl.classList.toggle('right', item.side === 'right');
      vexEl.classList.toggle('tip', !!item.tip);
      vexEl.classList.add('show');
      vexLive.textContent = item.text;
    }
    if (!item) return;
    const n = clamp(Math.floor((elapsed - V.INDICATOR) * V.TYPE_CPS), 0, item.text.length);
    if (n !== vexTyped) {
      vexTyped = n;
      vexShown.textContent = item.text.slice(0, n);
      vexRest.textContent = item.text.slice(n);
      vexEl.classList.toggle('waiting', elapsed < V.INDICATOR);
      vexEl.classList.toggle('typing', n < item.text.length);
    }
    const left = Math.round(clamp(1 - elapsed / dur, 0, 1) * 200) / 200;
    if (left !== vexBar) { vexBar = left; vexTimer.style.transform = `scaleX(${left})`; }
  }

  /* A wrong hop during a called laser move. One scolding per call, per attempt. */
  let routeLane = null;
  const roastedCues = new Set();
  function roastRoute(miss) {
    if (!miss || roastedCues.has(miss.id)) return;
    roastedCues.add(miss.id);
    sayNow(`What do you think ${miss.word} means? Muppet.`);
  }

  /* Shows a one-off line straight away. Lines VEX has used up come back as null. */
  function sayNow(text) {
    if (!text || !VEX_IN_PLAY) return 0;
    const now = performance.now(), dur = V.readTime(text);
    S.vexOverride = { text, start: now, until: now + dur * 1000, side: 'left', fork: -1 };
    return dur;
  }

  function tickVex(now) {
    if (MENU[S.mode] || S.mode === 'paused' || S.mode === 'loading') { showVex(null); return; }
    const o = S.vexOverride;
    if (o && now < o.until) { showVex(o, (now - o.start) / 1000, (o.until - o.start) / 1000); return; }
    if (S.mode !== 'play' || !S.p) { showVex(null); return; }
    const t = S.p.t;
    let active = null;
    for (const it of S.vexItems) {
      if (it.t0 > t) break;
      if (t < it.t1) active = it;
    }
    if (active) showVex(active, t - active.t0, active.t1 - active.t0);
    else showVex(null);
  }

  /* ---------- colour cues ---------- */

  /* The screen edge glows in the colour of the lane a cue calls for: steady while you
     get ready, flashing once the hop window opens, dim once you're on that lane.
     cueNow feeds drawLanes, which lights the lane itself the same way. */
  const cueEl = $('cue');
  const CUE = { lane: -1, go: false };
  let cueNow = null, cueShown = null, cueClass = '';
  function tickCue() {
    const c = S.mode === 'play' && S.lv && S.p && !S.p.dead ? C.at(S.lv, S.p.t) : null;
    if (!c) {
      cueNow = cueShown = null;
      if (cueClass) { cueClass = ''; cueEl.className = 'cue'; }
      return;
    }
    const ok = V.committedLane(S.p) === c.lane, go = S.p.t >= c.tGo;
    CUE.lane = c.lane;
    CUE.go = go && !ok;
    cueNow = CUE;
    if (c !== cueShown) {
      cueShown = c;
      cueClass = '';
      cueEl.style.setProperty('--cue', C.css(c.lane));
    }
    const cls = ok ? 'ok' : go ? 'go' : 'ready';
    if (cls !== cueClass) {
      cueClass = cls;
      cueEl.className = 'cue';
      void cueEl.offsetWidth;   // restarts the flash for a new colour or phase
      cueEl.className = `cue on ${cls}`;
    }
  }

  function vexCtx(extra) {
    const L = levelStat(S.level), nem = nemesis();
    return Object.assign({
      mode: S.game, n: S.level, attempt: S.attempt, tries: L[0], levelDeaths: L[1], deaths: stats.deaths,
      runs: stats.runs, mRuns: stats.mRuns, highestPrev: S.highestBefore, lives: S.lives, used: S.used,
      mBest: stats.mBest || 0, totalM: stats.metres, avgLifeM: avgLife(), runM: S.runMetres,
      bestRunM: stats.bestRun, lastLifeM: S.lastLifeM, hopsTotal: stats.hops, nemesisN: nem ? nem.n : 0,
      falls: stats.falls, hits: stats.hits,
    }, extra);
  }

  /* Points the colours at world w; instant snaps them, otherwise they fade over a second. */
  function setPalette(w, instant) {
    palTarget = makePalette(w);
    if (instant) for (let i = 0; i < 3; i++) { PAL.lane[i] = palTarget.lane[i]; PAL.bg[i] = palTarget.bg[i]; }
    const root = document.documentElement.style;
    root.setProperty('--lane', cssColor(palTarget.lane));
    root.setProperty('--void', cssColor(palTarget.bg));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', cssColor(palTarget.bg));
  }

  const screens = ['scrTitle', 'scrPause', 'scrOver', 'scrWin', 'scrStats', 'scrName', 'scrBoards', 'scrJoin', 'scrLobby', 'scrRaceEnd'];
  function showScreen(id) {
    for (const s of screens) $(s).hidden = s !== id;
    const playing = !id || id === 'scrPause';
    hud.hidden = !playing;
    pads.hidden = !!id;
    if (!playing) badge.hidden = true;
  }

  function focusFirst(id) {
    const b = $(id).querySelector('button:not([hidden])');
    if (b && matchMedia('(hover: hover)').matches) b.focus({ preventScroll: true });
  }

  /* ---------- screen wake lock ---------- */

  let wakeLock = null;
  function requestWake() {
    try {
      if (navigator.wakeLock && !wakeLock) {
        navigator.wakeLock.request('screen').then((l) => {
          wakeLock = l;
          l.addEventListener('release', () => { wakeLock = null; });
        }).catch(() => {});
      }
    } catch (e) { /* not available */ }
  }
  function releaseWake() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* already gone */ }
    wakeLock = null;
  }

  /* ---------- distance and stats ---------- */

  function addDistance(m) {
    stats.metres += m;
    S.runMetres += m;
    S.lifeMetres += m;
    if (S.runMetres > stats.bestRun) stats.bestRun = S.runMetres;
  }

  function endLife() {
    stats.deadLifeMetres += S.lifeMetres;
    stats.longestLife = Math.max(stats.longestLife, S.lifeMetres);
    S.lastLifeM = S.lifeMetres;
    S.lifeMetres = 0;
  }

  function saveRun() {
    if (S.game === 'race') return;   // races aren't saved
    writeJSON(RUN_KEYS[S.game], {
      level: S.level, lives: S.lives, used: S.used, metres: Math.round(S.runMetres * 10) / 10,
      life: Math.round(S.lifeMetres * 10) / 10, time: Math.round(S.runTime * 10) / 10, said: V.memory(),
      runId: S.ranked && S.ranked.ranked ? S.ranked.runId || null : null,
    });
  }

  function fillStatList(el, rows) {
    el.textContent = '';
    for (const [k, v] of rows) {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      div.append(dt, dd);
      el.append(div);
    }
  }

  function fillStatsScreen() {
    const nem = nemesis();
    fillStatList($('statsList'), [
      ['Survival best', stats.highest ? `Level ${stats.highest}` : '—'],
      ['Marathon best', stats.mBest ? plural(stats.mBest, 'life', 'lives') : '—'],
      ['Marathon furthest', stats.mFurthest ? `Level ${stats.mFurthest} (${plural(stats.mFurthestUsed, 'life', 'lives')})` : '—'],
      ['Distance travelled', fmtDist(stats.metres)],
      ['Lives lost', stats.deaths.toLocaleString('en-GB')],
      ['Average per life', stats.deaths ? fmtDist(avgLife()) : '—'],
      ['Longest life', stats.longestLife ? fmtDist(stats.longestLife) : '—'],
      ['Best run distance', stats.bestRun ? fmtDist(stats.bestRun) : '—'],
      ['Falls / hits', `${stats.falls} / ${stats.hits}`],
      ['Toughest level', nem ? `Level ${nem.n} (${nem.deaths})` : '—'],
      ['Survival runs', stats.runs.toLocaleString('en-GB')],
      ['Marathons started', stats.mRuns.toLocaleString('en-GB')],
      ['Levels cleared', stats.clears.toLocaleString('en-GB')],
      ['Hops pressed', stats.hops.toLocaleString('en-GB')],
      ['Time played', fmtTime(stats.playTime)],
      ['Fastest survival win', stats.bestTime != null ? fmtTime(stats.bestTime) : '—'],
    ]);
  }

  /* ---------- run flow ---------- */

  function startRun(game, fresh) {
    S.game = game;
    const saved = fresh ? null : readRun(game);
    S.highestBefore = stats.highest;
    if (saved) {
      S.level = saved.level; S.lives = saved.lives || 3; S.used = saved.used;
      S.runMetres = saved.metres; S.lifeMetres = saved.life; S.runTime = saved.time;
      V.resetMemory(saved.said);
    } else {
      S.level = 1; S.lives = 3; S.used = 0; S.runMetres = 0; S.lifeMetres = 0; S.runTime = 0;
      V.resetMemory([]);
      if (game === 'survival') stats.runs++; else stats.mRuns++;
      saveStats();
    }
    // Ranked when the leaderboard server is up and you have a name. A saved run stays
    // ranked or unranked as it started.
    S.ranked = null;
    S.syncNext = false;
    if (O.online && O.player && (!saved || saved.runId)) {
      S.ranked = O.rankedRun(game, G.VERSION, saved ? saved.runId : null, rankedHooks);
      if (saved) { S.ranked.resume(); S.syncNext = true; } else S.ranked.start();
    }
    S.attempt = 0;
    S.vexOverride = null;
    particles.length = 0;
    showScreen(null);
    requestWake();
    beginLevel('start');
  }

  /* Start buttons: the first time leaderboards are available, ask for a name first. */
  function requestStart(game, fresh) {
    const saved = fresh ? null : readRun(game);
    if (!saved && O.online && !O.player && !S.nameAsked) {
      S.nameAsked = true;
      openName({ then: () => startRun(game, fresh), skip: () => startRun(game, fresh) });
      return;
    }
    startRun(game, fresh);
  }

  /* Each try at a level. Hops are logged by tick so the server can replay it exactly. */
  function startAttempt(lane0) {
    S.inputs.length = 0;
    S.log = [];
    S.lane0 = lane0;
    S.acc = 0;
    if (S.ranked) S.ranked.attempt(S.level);
  }
  function finishAttempt(outcome) {
    if (S.ranked) S.ranked.finish({ outcome, inputs: S.log, endTick: S.p.tick, lane0: S.lane0 });
  }

  /* Leaving a ranked level part-way costs that life, so quitting just before a death gains nothing. */
  function forfeitAttempt() {
    finishAttempt('quit');
    addDistance(Math.min(S.p.s, S.lv.length) / UNITS_PER_METRE);
    endLife();
    if (S.game === 'survival') S.lives -= 1; else S.used += 1;
    stats.deaths++;
    levelStat(S.level)[1]++;
    if (S.game === 'survival' && S.lives <= 0) writeJSON(RUN_KEYS.survival, null);
    else saveRun();
  }

  const UNRANKED_REASONS = {
    version: 'This copy of the game is out of date, so this run isn\u2019t ranked.',
    'run-over': 'That run already ended on the leaderboard server, so this one isn\u2019t ranked.',
    level: 'The server and this device disagree about your run, so it\u2019s no longer ranked.',
    unverified: 'The server couldn\u2019t verify that clear, so this run is no longer ranked.',
    auth: 'The leaderboard server didn\u2019t recognise you. Pick a name again to play ranked.',
  };
  const rankedHooks = {
    onSync(run, result) {
      // The first attempt after continuing: the server may have counted a life for
      // the attempt you left unfinished last time.
      if (!S.syncNext || !result || !result.started || !S.ranked || run.id !== S.ranked.runId) return;
      S.syncNext = false;
      const lost = S.game === 'survival' ? S.lives - run.lives : run.livesUsed - S.used;
      if (lost > 0) {
        if (S.game === 'survival') S.lives = run.lives; else S.used = run.livesUsed;
        renderHud();
        saveRun();
        toast('Leaving mid-level last time cost a life.');
      }
    },
    onUnranked(err) {
      toast(UNRANKED_REASONS[err.code] || (err.status ? err.message : 'Lost touch with the leaderboard server. This run is no longer ranked.'));
      saveRun();
    },
  };

  let toastTimer = 0;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 250); }, 4200);
  }

  /* Starts the current level from its start line, with a short countdown. */
  function beginLevel(reason) {
    const lv = store.get(S.level);
    if (!lv) {
      S.mode = 'loading';
      S.pendingReason = reason;
      showBanner('Building', `Level ${S.level}`);
      store.load(S.level, () => { if (S.mode === 'loading') beginLevel(S.pendingReason); });
      return;
    }
    S.lv = lv;
    S.prev = null;
    S.camBlend = null;
    S.slide = null;
    if (reason !== 'retry') S.attempt = 0;
    S.attempt++;
    noteLevelStart();
    let intro = reason === 'retry' ? 1.1 : (S.level - 1) % 10 === 0 || S.level === G.LEVEL_COUNT ? 2.6 : 1.6;
    // A race's first level counts down to the same moment on every racer's screen.
    if (reason === 'race') intro = Math.max(0.6, (S.race.goAt - performance.now()) / 1000);
    S.p = G.newRunner(lv, intro);
    startAttempt(S.p.lane);
    S.mode = 'play';
    S.hold = 0;
    trail.length = 0;
    setPalette(lv.world, true);
    saveRun();
    renderHud();
    snapCam = true;
    let eyebrow = `World ${lv.world + 1} · ${lv.name}`;
    if (reason === 'retry') eyebrow = S.game === 'marathon' ? `Life ${(S.used + 1).toLocaleString('en-GB')}` : S.lives === 1 ? 'Last life' : `${S.lives} lives left`;
    if (S.game === 'race') {
      eyebrow = reason !== 'retry' ? `Race \u00b7 first to clear level ${S.race.target}`
        : S.race.backTo ? 'Back to your checkpoint' : plural(S.used, 'death', 'deaths');
    }
    showBanner(eyebrow, `Level ${S.level}`);
    planVex(reason === 'retry' ? null : -intro + 0.2);
    if (reason === 'race') quip('start');
    if (S.level < G.LEVEL_COUNT) store.load(S.level + 1);
  }

  function noteLevelStart() {
    levelStat(S.level)[0]++;
    if (S.game === 'survival' && S.level > stats.highest) stats.highest = S.level;
    if (S.game === 'marathon' && S.level > stats.mFurthest) { stats.mFurthest = S.level; stats.mFurthestUsed = S.used; }
    saveStats();
  }

  /* Lines up VEX for this attempt. introAt: when the level-start line shows (null: none). */
  function planVex(introAt, from, alsoSaying) {
    S.toldForks = new Set();
    roastedCues.clear();
    routeLane = null;
    if (!VEX_IN_PLAY) { S.vexItems = []; return; }
    const ctx = vexCtx();
    const text = introAt != null ? V.intro(S.lv, S.attempt, ctx) : null;
    S.vexItems = V.plan(S.lv, S.attempt, ctx, from, [text, alsoSaying].filter(Boolean));
    if (introAt != null) {
      if (text) {
        const first = S.vexItems.length ? S.vexItems[0].t0 : 99;
        S.vexItems.unshift({ t0: introAt, t1: Math.max(introAt + 1.8, Math.min(introAt + V.readTime(text), first - 0.1)), text, side: 'left', fork: -1, tip: V.isTipText(text) });
      }
    }
  }

  /* Finish line crossed: run straight on into the next level without stopping. */
  function onLevelDone() {
    const old = S.lv, p = S.p;
    finishAttempt('clear');
    addDistance(old.length / UNITS_PER_METRE);
    levelStat(S.level)[2]++;
    stats.clears++;
    saveStats();
    burst(cam.px, cam.py, cam.pz, 30, FINISH, 320);
    flash([0.86, 1, 0.7], 0.12);
    cam.kick = 0.35;
    if (S.level >= (S.game === 'race' ? S.race.target : G.LEVEL_COUNT)) {
      S.mode = 'clear';
      S.timer = 1.2;
      showBanner(`Level ${S.level}`, S.game === 'race' ? 'Finished' : 'Clear', 99);
      if (S.game === 'race') { S.race.done = true; RC.finish(S.level); }
      return;
    }

    const next = store.now(S.level + 1);
    const xf = makeXf(old, next);
    // Which lane of the new level is nearest to where the dot is.
    const uGoal = G.laneU(old, p.lane, old.length, p.t);
    const uSeen = G.laneU(old, p.l, old.length, p.t);
    let lane = 0, best = Infinity;
    for (let x = 0; x < next.lanes; x++) {
      const d = Math.abs(G.laneU(next, x, 0, 0) - uGoal);
      if (d < best) { best = d; lane = x; }
    }
    // Carry everything already on screen into the new level's coordinates.
    for (let i = 0; i < trail.length; i += 3) {
      Q.x = trail[i]; Q.y = trail[i + 1]; Q.th = 0;
      applyXf(xf, Q);
      trail[i] = Q.x; trail[i + 1] = Q.y;
    }
    for (const q of particles) {
      Q.x = q.x; Q.y = q.y; Q.th = 0;
      applyXf(xf, Q);
      q.x = Q.x; q.y = Q.y;
      const vx = q.vx;
      q.vx = xf.c * vx - xf.s * q.vy;
      q.vy = xf.s * vx + xf.c * q.vy;
    }
    S.prev = { lv: old, xf, t0: p.t };
    S.camBlend = { yaw: cam.yaw + xf.phi, roll: cam.roll, mirror: cam.mirror, k: 0 };
    S.slide = { u: uSeen - G.laneU(next, lane, 0, 0), k: 0 };

    S.level++;
    S.lv = next;
    S.attempt = 1;
    noteLevelStart();
    S.p = G.newRunner(next, 0);
    S.p.lane = S.p.from = S.p.l = lane;
    startAttempt(lane);
    if (S.game === 'race' && (S.level - S.race.start) % S.race.settings.checkpoint === 0) RC.event('checkpoint', S.level);
    setPalette(next.world, false);
    saveRun();
    renderHud();
    showBanner(`World ${next.world + 1} · ${next.name}`, `Level ${S.level}`, 1.4);
    const clearLine = VEX_IN_PLAY ? V.clear(S.level - 1) : null;
    const quip = sayNow(clearLine);
    planVex(quip ? quip + 0.15 : 0.15, quip ? quip + 1 : 1, clearLine);
    if (S.level < G.LEVEL_COUNT) store.load(S.level + 1);
  }

  function onDeath() {
    const p = S.p, lv = S.lv;
    finishAttempt('death');
    if (S.game === 'race') RC.event('death', S.level);
    S.mode = 'dying';
    S.timer = 1.05;
    S.deathClock = 0;
    addDistance(Math.min(p.s, lv.length) / UNITS_PER_METRE);
    endLife();
    if (S.game === 'survival') S.lives -= 1; else S.used += 1;
    stats.deaths++;
    levelStat(S.level)[1]++;
    if (p.dead === 'fall') stats.falls++; else stats.hits++;
    saveStats();
    if (p.dead === 'hit') {
      burst(cam.px, cam.py, cam.pz, 40, DOT, 360);
      burst(cam.px, cam.py, cam.pz, 14, WHITE, 220);
      cam.shake = 0.5;
    } else {
      burst(cam.px, cam.py, cam.pz, 12, C.color(p.lane).slice(), 120);
      cam.shake = 0.22;
    }
    cam.kick = 1;
    flash(LASER, 0.32);
    trail.length = 0;
    if (S.game === 'marathon' || S.lives > 0) {
      saveRun();
      const de = p.why === 'deadend' ? lv.deadEnds[p.fork] : null;
      sayNow(V.intro(lv, S.attempt + 1, vexCtx({
        retry: true, why: p.why, attempt: S.attempt + 1,
        told: !!de && S.toldForks.has(p.fork), side: de ? de.side : '',
        ignored: V.ignoredWord(lv, p),
      })));
    } else {
      writeJSON(RUN_KEYS.survival, null);
    }
    renderHud();
  }

  function afterDeath() {
    if (S.game === 'race') {
      // Back to the last checkpoint: the race's first level, then every 1, 3 or 5 levels after it.
      const { start, checkpoint } = S.race.settings;
      const cp = start + Math.floor((S.level - start) / checkpoint) * checkpoint;
      S.race.backTo = cp !== S.level;
      S.level = cp;
      beginLevel('retry');
      return;
    }
    if (S.game === 'marathon' || S.lives > 0) beginLevel('retry');
    else gameOver();
  }

  function gameOver() {
    S.mode = 'over';
    releaseWake();
    hideBanner();
    $('overText').textContent = `You reached level ${S.level} and travelled ${fmtDist(S.runMetres)}.`;
    $('overNote').hidden = !(S.level > S.highestBefore);
    fillStatList($('overStats'), [
      ['This run', fmtDist(S.runMetres)],
      ['Average per life', fmtDist(avgLife())],
      ['Lives lost, all time', stats.deaths.toLocaleString('en-GB')],
    ]);
    $('overVex').textContent = V.over(vexCtx());
    startAttract();
    showScreen('scrOver');
    focusFirst('scrOver');
    showRank('overRank', 'survival');
  }

  function winRun() {
    S.mode = 'win';
    releaseWake();
    hideBanner();
    let note;
    if (S.game === 'survival') {
      stats.wins++;
      const best = stats.bestTime == null || S.runTime < stats.bestTime;
      if (best) stats.bestTime = Math.round(S.runTime * 10) / 10;
      $('winEyebrow').textContent = 'Survival · level 100 clear';
      $('winText').textContent = `All ${G.LEVEL_COUNT} levels, ${fmtDist(S.runMetres)}, with ${plural(S.lives, 'life', 'lives')} to spare.`;
      note = best ? 'That’s your fastest survival win.' : `Your fastest survival win took ${fmtTime(stats.bestTime)}.`;
    } else {
      stats.mFinishes++;
      const best = stats.mBest == null || S.used < stats.mBest;
      if (best) stats.mBest = S.used;
      $('winEyebrow').textContent = 'Marathon · level 100 clear';
      $('winText').textContent = `Score: ${plural(S.used, 'life', 'lives')} to get through all ${G.LEVEL_COUNT} levels.`;
      note = best ? 'That’s your best marathon. Lower is better.' : `Your best marathon took ${plural(stats.mBest, 'life', 'lives')}.`;
    }
    saveStats();
    writeJSON(RUN_KEYS[S.game], null);
    $('winNote').textContent = note;
    $('winVex').textContent = V.WIN[S.game];
    startAttract();
    showScreen('scrWin');
    focusFirst('scrWin');
    showRank('winRank', S.game);
  }

  function pause() {
    if (S.mode !== 'play') return;
    S.mode = 'paused';
    saveRun();
    saveStats();
    releaseWake();
    const lifeText = S.game === 'marathon' ? `${plural(S.used, 'life', 'lives')} used` : `${plural(S.lives, 'life', 'lives')} left`;
    const rankedNow = !!(S.ranked && S.ranked.ranked);
    $('pauseText').textContent = `Level ${S.level} \u00b7 ${lifeText} \u00b7 ${fmtDist(runDistanceNow())}${rankedNow ? ' \u00b7 Ranked' : ''}`;
    const costly = rankedNow && S.p.t > 0;
    $('btnQuit').textContent = costly ? 'Quit (costs a life)' : 'Save and quit';
    $('pauseNote').textContent = costly
      ? 'This is a ranked run, so leaving a level part-way costs that life.'
      : 'Quitting keeps your lives. You\u2019ll restart this level when you continue.';
    if (S.game === 'race') {
      $('pauseText').textContent = `Race \u00b7 level ${S.level} of ${S.race.target} \u00b7 ${plural(S.used, 'death', 'deaths')}`;
      $('btnQuit').textContent = 'Leave race';
      $('pauseNote').textContent = 'The race carries on while you\u2019re paused. Leaving ends it for you.';
    }
    $('pauseVex').textContent = V.pause();
    showScreen('scrPause');
    focusFirst('scrPause');
  }

  function resume() {
    if (S.mode !== 'paused') return;
    showScreen(null);
    S.mode = 'play';
    if (S.p.t > 0) {
      S.hold = 0.9;
      showBanner('Get ready', `Level ${S.level}`, 99);
    }
    requestWake();
  }

  function toTitle() {
    if (S.game === 'race' || S.race) {
      if (S.mode === 'paused' && S.p) addDistance(Math.min(S.p.s, S.lv.length) / UNITS_PER_METRE);
      leaveRace();
      saveStats();
    } else if (S.mode === 'paused') {
      if (S.ranked && S.ranked.ranked && S.p.t > 0) {
        forfeitAttempt();
      } else {
        // Before the dot moves a ranked attempt is simply cancelled; unranked runs don't report at all.
        if (S.p.t <= 0) finishAttempt('cancel');
        // The level restarts on continue, but the distance already covered still counts.
        addDistance(Math.min(S.p.s, S.lv.length) / UNITS_PER_METRE);
        saveRun();
      }
      saveStats();
    }
    S.mode = 'title';
    releaseWake();
    hideBanner();
    refreshTitle();
    startAttract();
    showScreen('scrTitle');
    focusFirst('scrTitle');
  }

  /* After a ranked run ends: where it landed on its leaderboard. */
  function showRank(id, board) {
    const el = $(id);
    el.hidden = true;
    const run = S.ranked;
    if (!run || !run.ranked) return;
    run.idle().then(() => (run.ranked ? O.me() : null)).then((me) => {
      const rank = me && me.ranks && me.ranks[board];
      if (!rank) return;
      el.textContent = `#${rank} on the ${board} leaderboard.`;
      el.hidden = false;
    }).catch(() => {});
  }

  /* ---------- races ---------- */

  const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  let raceSettings = { start: 1, length: 5, checkpoint: 5 };   // the host's last choices
  let quipAt = 0;

  const newRace = () => ({ room: null, you: null, settings: null, start: 1, target: 1, rivals: new Map(), result: null, done: false, goAt: 0, posAt: 0, barAt: 0, backTo: false });

  /* Racing needs a leaderboard name; ask for one first if needed. */
  function haveName(then) {
    if (O.player) return true;
    openName({ then });
    return false;
  }

  function hostRace() {
    if (!haveName(hostRace)) return;
    S.race = newRace();
    showLobby();
    RC.host(O.player.token, raceSettings).catch((err) => raceError(err.message));
  }

  function openJoin() {
    if (!haveName(openJoin)) return;
    S.mode = 'join';
    $('joinError').hidden = true;
    $('joinCode').value = '';
    showScreen('scrJoin');
    $('joinCode').focus({ preventScroll: true });
  }

  function submitJoin(e) {
    e.preventDefault();
    const code = $('joinCode').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { raceError('Room codes are 4 letters.'); return; }
    S.race = newRace();
    RC.join(O.player.token, code).catch((err) => raceError(err.message));
  }

  function raceError(message) {
    const id = S.mode === 'join' ? 'joinError' : S.mode === 'lobby' ? 'lobbyError' : null;
    if (!id) { toast(message); return; }
    $(id).textContent = message;
    $(id).hidden = false;
  }

  function leaveRace() {
    clearTimeout(rejoinTimer);
    RC.leave();
    S.race = null;
    if (S.game === 'race') S.game = 'survival';
  }

  function changeRaceSettings() {
    raceSettings = { start: Number($('raceStart').value), length: Number($('raceLength').value), checkpoint: Number($('raceCheckpoint').value) };
    RC.settings(raceSettings);
  }

  function showLobby() {
    S.mode = 'lobby';
    renderLobby();
    showScreen('scrLobby');
  }

  function renderLobby() {
    const room = S.race && S.race.room;
    $('lobbyError').hidden = true;
    const list = $('lobbyPlayers');
    list.textContent = '';
    if (!room) {
      $('lobbyCode').textContent = '\u2026';
      $('lobbyJoinHint').textContent = 'Opening a room\u2026';
      $('btnRaceGo').hidden = true;
      return;
    }
    const isHost = room.hostId === S.race.you;
    $('lobbyCode').textContent = room.code;
    const url = O.publicUrl || (/^(localhost|127\.)/.test(location.hostname) ? null : location.origin);
    $('lobbyJoinHint').textContent = url
      ? `Friends on the same Wi-Fi open ${url}, tap Join, and type this code.`
      : 'Friends on the same Wi-Fi open this computer\u2019s address on port 8080, tap Join, and type this code.';
    for (const p of room.players.filter((q) => !q.left)) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'p-dot';
      dot.style.background = p.id === S.race.you ? '#ff4fd8' : p.color;
      const name = document.createElement('span');
      name.className = 'p-name';
      name.textContent = p.name;
      const tag = document.createElement('span');
      tag.className = 'p-tag';
      tag.textContent = [p.host ? 'host' : '', p.id === S.race.you ? 'you' : ''].filter(Boolean).join(' \u00b7 ');
      li.append(dot, name, tag);
      list.append(li);
    }
    const { start, length, checkpoint } = room.settings;
    $('raceStart').value = String(start);
    $('raceLength').value = String(length);
    $('raceCheckpoint').value = String(checkpoint);
    for (const opt of $('raceLength').options) opt.disabled = start + Number(opt.value) - 1 > G.LEVEL_COUNT;
    for (const id of ['raceStart', 'raceLength', 'raceCheckpoint']) $(id).disabled = !isHost;
    const end = start + length - 1, cps = [];
    for (let n = start; n <= end; n += checkpoint) cps.push(n);
    $('lobbySummary').textContent = `Levels ${start} to ${end}. ` + (checkpoint === 1
      ? 'Dying restarts the level you\u2019re on.'
      : cps.length === 1 ? `Dying sends you back to level ${start}.`
      : `Checkpoints at levels ${cps.slice(0, -1).join(', ')} and ${cps[cps.length - 1]}. Dying sends you back to the last one you reached.`);
    const enough = room.players.filter((q) => !q.left).length >= 2;
    $('btnRaceGo').hidden = !isHost;
    $('btnRaceGo').disabled = !enough;
    $('btnRaceGo').textContent = enough ? 'Start race' : 'Waiting for someone to join\u2026';
    $('lobbyWait').hidden = isHost;
    store.load(start);
  }

  function startRace(settings, startsIn) {
    if (!S.race) return;
    S.game = 'race';
    Object.assign(S.race, {
      settings, start: settings.start, target: settings.start + settings.length - 1,
      rivals: new Map(), result: null, done: false, posAt: 0, barAt: 0, backTo: false, goAt: performance.now() + startsIn,
    });
    $('raceTrack').textContent = '';
    S.level = settings.start;
    S.lives = 3;
    S.used = 0;
    S.runMetres = 0; S.lifeMetres = 0; S.runTime = 0;
    S.ranked = null;
    S.attempt = 0;
    S.vexOverride = null;
    V.resetMemory([]);
    particles.length = 0;
    showScreen(null);
    requestWake();
    beginLevel('race');
  }

  /* How far through the race you are, 0 to 1. */
  function myProgress() {
    const race = S.race;
    if (!race || !S.p || !S.lv || !race.settings) return 0;
    const within = S.mode === 'clear' ? 1 : clamp(S.p.s / S.lv.length, 0, 1);
    return clamp((S.level - race.start + within) / race.settings.length, 0, 1);
  }

  function sendRacePos(now) {
    if (now - S.race.posAt < 100) return;
    S.race.posAt = now;
    RC.pos({ level: S.level, s: S.p.s, l: S.p.l, t: S.p.t, alive: S.mode === 'play' && !S.p.dead, progress: myProgress(), deaths: S.used });
  }

  function quip(kind, name) {
    const now = performance.now();
    if (kind !== 'start' && now - quipAt < 6000) return;
    const line = V.race(kind, { name: name || '', target: S.race ? S.race.target : '' });
    if (line) { sayNow(line); quipAt = now; }
  }

  /* Rivals on your level: see-through dots in their colours, nudged forward between updates. */
  function drawRivals(lv, p, sA, sB) {
    const now = performance.now();
    for (const r of S.race.rivals.values()) {
      if (r.level !== S.level || !r.alive || now - r.at > 1500) continue;
      const s = r.s + G.speedAt(lv, r.s) * Math.min(0.25, (now - r.at) / 1000);
      if (s < sA || s > sB || s > lv.length) continue;
      place(lv, s, G.laneU(lv, r.l, s, p.t), Q);
      const z = G.heightAt(lv, s) + 5, c = r.rgb, rad = G.PLAYER_R;
      R.sprite(Q.x, Q.y, z, rad * 4, c[0], c[1], c[2], 0.35, -1, 0, 0);
      R.sprite(Q.x, Q.y, z, rad / 0.5, c[0], c[1], c[2], 0.6, 0.5, 0, 0);
    }
  }

  /* The bar under the HUD: one marker per racer, by how far through the race they are. */
  function updateRaceBar(now) {
    const race = S.race;
    if (now - race.barAt < 100) return;
    race.barAt = now;
    const track = $('raceTrack');
    const entries = [{ id: race.you, name: 'You', color: '#ff4fd8', progress: myProgress(), you: true }];
    for (const r of race.rivals.values()) entries.push({ id: r.id, name: r.name, color: r.color, progress: r.progress });
    for (const e of entries) {
      let el = track.querySelector(`[data-id="${e.id}"]`);
      if (!el) {
        el = document.createElement('span');
        el.className = 'race-dot' + (e.you ? ' you' : '');
        el.dataset.id = e.id;
        el.textContent = e.you ? '' : e.name.charAt(0).toUpperCase();
        el.title = e.name;
        el.style.background = e.color;
        track.append(el);
      }
      el.style.left = `${(e.progress * 100).toFixed(1)}%`;
    }
  }

  function showRaceEnd() {
    const race = S.race, res = race && race.result;
    if (!res) return;
    S.mode = 'raceEnd';
    releaseWake();
    hideBanner();
    const won = res.winner.id === race.you;
    $('raceEndTitle').textContent = won ? 'You won' : `${res.winner.name} wins`;
    const list = $('raceStandings');
    list.textContent = '';
    for (const p of res.standings) {
      const me = p.id === race.you;
      const li = boardItem(me ? 'me' : '', `#${p.place}`, p.name + (me ? ' (you)' : ''),
        p.done ? 'Finished' : p.left ? 'Left' : `Level ${p.level}`, plural(p.deaths, 'death', 'deaths'));
      li.querySelector('.b-name').style.setProperty('--racer', me ? '#ff4fd8' : p.color);
      li.classList.add('racer');
      list.append(li);
    }
    const isHost = race.room && race.room.hostId === race.you;
    $('btnRaceAgain').hidden = !isHost;
    $('raceEndWait').hidden = isHost;
    $('raceEndVex').textContent = V.race(won ? 'won' : 'lost', { name: res.winner.name }) || '';
    startAttract();
    showScreen('scrRaceEnd');
  }

  RC.on('room', (msg) => {
    const race = S.race;
    if (!race) return;
    race.room = msg.room;
    race.you = msg.you;
    if (msg.room.state === 'lobby' && (S.mode === 'lobby' || S.mode === 'join' || S.mode === 'raceEnd')) showLobby();
    else if (msg.room.state === 'lobby' && S.game === 'race' && S.mode !== 'title') {
      // Back from a dropped connection to find the race over and the host already lining up the next one.
      toast('That race finished while you were away.');
      releaseWake();
      hideBanner();
      startAttract();
      showLobby();
    } else if (msg.room.state === 'racing' && race.done && !race.result) RC.finish(race.target);   // finished while offline
  });
  RC.on('error', (msg) => raceError(msg.message));
  RC.on('start', (msg) => startRace(msg.settings, msg.startsIn));
  RC.on('positions', (msg) => {
    const race = S.race;
    if (!race || S.game !== 'race') return;
    const now = performance.now(), mine = myProgress();
    for (const p of msg.players) {
      if (p.id === race.you) continue;
      const info = race.room && race.room.players.find((q) => q.id === p.id);
      const prev = race.rivals.get(p.id);
      if (prev && S.mode === 'play') {
        if (prev.progress <= mine && p.progress > mine) quip('passed', prev.name);
        else if (prev.progress > mine && p.progress <= mine) quip('passing', prev.name);
      }
      const color = info ? info.color : '#ffffff';
      race.rivals.set(p.id, Object.assign(prev || {}, p, { at: now, name: info ? info.name : '?', color, rgb: hexRgb(color) }));
    }
  });
  RC.on('event', (msg) => {
    if (!S.race || S.game !== 'race' || msg.id === S.race.you) return;
    if (msg.kind === 'death') quip('rivalDied', msg.name);
    else if (msg.kind === 'left' || msg.kind === 'dropped' || msg.kind === 'back') quip(msg.kind, msg.name);
  });
  RC.on('finished', (msg) => {
    if (!S.race) return;
    S.race.result = msg;
    if (S.game === 'race' && S.mode !== 'clear') showRaceEnd();
  });
  /* Phones drop the connection when the screen locks or another app comes to the front.
     The race carries on here meanwhile; reconnect quietly and take the same place back. */
  let rejoinTimer = 0, rejoinTries = 0;
  function rejoinRace() {
    clearTimeout(rejoinTimer);
    const race = S.race;
    if (!race || !race.room || RC.connected) return;
    rejoinTries++;
    RC.rejoin(O.player.token, race.room.code).then(() => {
      rejoinTries = 0;
      if (S.race !== race) RC.leave();   // left while reconnecting
    }).catch(() => {
      if (S.race !== race) return;
      if (rejoinTries >= 8) raceGone('Lost the connection to the race.');
      else rejoinTimer = setTimeout(rejoinRace, Math.min(4000, 600 * rejoinTries));
    });
  }
  function raceGone(message) {
    clearTimeout(rejoinTimer);
    if (!S.race) return;
    toast(message);
    if (S.mode !== 'title') toTitle(); else leaveRace();
  }
  RC.on('gone', (msg) => raceGone(msg.message));
  RC.on('closed', (msg) => {
    if (!S.race) return;
    // 4000: the server closed the room itself, so there's nothing to go back to.
    if (msg.code === 4000 || !S.race.room) { raceGone(msg.message || 'Lost the connection to the race.'); return; }
    if (S.mode !== 'paused') toast('Connection dropped. Reconnecting…');
    rejoinTries = 0;
    rejoinRace();
  });

  /* ---------- nickname ---------- */

  let nameFlow = null;
  function openName(flow) {
    nameFlow = flow || {};
    S.mode = 'name';
    const input = $('nameInput');
    input.value = O.player ? O.player.nickname : '';
    $('nameError').hidden = true;
    $('nameTitle').textContent = O.player ? 'Change name' : 'Pick a name';
    $('btnNameSkip').textContent = nameFlow.skip ? 'Play unranked' : 'Back';
    showScreen('scrName');
    input.focus({ preventScroll: true });
  }
  function leaveName() {
    S.mode = 'title';
    refreshTitle();
    showScreen('scrTitle');
    focusFirst('scrTitle');
  }
  function skipName() {
    const flow = nameFlow || {};
    nameFlow = null;
    if (flow.skip) flow.skip(); else leaveName();
  }
  async function submitName(e) {
    e.preventDefault();
    const btn = $('btnNameSave'), err = $('nameError');
    btn.disabled = true;
    btn.textContent = 'Saving\u2026';
    try {
      const name = $('nameInput').value;
      if (O.player) await O.rename(name); else await O.register(name);
      const flow = nameFlow || {};
      nameFlow = null;
      if (flow.then) flow.then(); else leaveName();
    } catch (ex) {
      err.textContent = ex.status ? ex.message : 'Couldn\u2019t reach the leaderboard server. Try again in a moment.';
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save name';
    }
  }

  /* ---------- leaderboards ---------- */

  const BOARD_NOTES = {
    survival: 'Furthest level on 3 lives. Ties go to whoever travelled further.',
    marathon: 'Fewest lives used to finish all 100 levels.',
    'marathon-live': 'Marathons still going: furthest level first, then fewest lives used.',
    distance: 'Total distance travelled, every run, every mode.',
    deaths: 'Most lives lost. A hall of shame.',
    levels: 'The levels that have killed the most players.',
  };
  let boardReq = 0;
  function openBoards() {
    S.boardsBack = S.mode;
    S.mode = 'boards';
    showScreen('scrBoards');
    loadBoard(S.board);
  }
  function closeBoards() {
    S.mode = MENU[S.boardsBack] && S.boardsBack !== 'boards' ? S.boardsBack : 'title';
    const id = { title: 'scrTitle', over: 'scrOver', win: 'scrWin', stats: 'scrStats' }[S.mode] || 'scrTitle';
    if (S.mode === 'title') refreshTitle();
    showScreen(id);
    focusFirst(id);
  }
  function boardItem(cls, rank, name, value, detail) {
    const li = document.createElement('li');
    li.className = cls;
    const a = document.createElement('span'); a.className = 'b-rank'; a.textContent = rank;
    const b = document.createElement('span'); b.className = 'b-name'; b.textContent = name;
    const c = document.createElement('span'); c.className = 'b-val'; c.textContent = value;
    if (detail) { const sm = document.createElement('small'); sm.textContent = detail; c.append(sm); }
    li.append(a, b, c);
    return li;
  }
  async function loadBoard(name) {
    S.board = name;
    for (const t of document.querySelectorAll('#boardTabs [data-board]')) t.setAttribute('aria-selected', String(t.dataset.board === name));
    $('boardNote').textContent = BOARD_NOTES[name];
    const list = $('boardList');
    list.textContent = '';
    list.append(boardItem('b-empty', '', 'Loading\u2026', ''));
    const req = ++boardReq;
    try {
      const r = await O.board(name);
      if (req !== boardReq) return;
      list.textContent = '';
      if (!r.rows.length) list.append(boardItem('b-empty', '', 'Nobody here yet. Be the first.', ''));
      let prev = 0;
      for (const row of r.rows) {
        if (row.rank > prev + 1) list.append(boardItem('b-gap', '', '\u2026', ''));
        const li = boardItem(row.me ? 'me' : '', `#${row.rank}`, row.nickname + (row.me ? ' (you)' : ''), row.value, row.detail);
        if (row.live) li.classList.add('live');
        list.append(li);
        prev = row.rank;
      }
    } catch (e) {
      if (req !== boardReq) return;
      list.textContent = '';
      list.append(boardItem('b-empty', '', 'Couldn\u2019t load this leaderboard. Check your connection.', ''));
    }
  }

  function openStats() {
    S.menuBack = S.mode;
    S.mode = 'stats';
    fillStatsScreen();
    showScreen('scrStats');
    focusFirst('scrStats');
  }

  function closeStats() {
    S.mode = S.menuBack === 'stats' ? 'title' : S.menuBack;
    const id = { title: 'scrTitle', over: 'scrOver', win: 'scrWin' }[S.mode] || 'scrTitle';
    showScreen(id);
    focusFirst(id);
  }

  /* ---------- title screen ---------- */

  const armed = { survival: 0, marathon: 0 };
  function refreshTitle() {
    for (const game of ['survival', 'marathon']) {
      const run = readRun(game);
      const key = game === 'survival' ? 'Survival' : 'Marathon';
      $(`btn${key}`).textContent = run ? 'Continue' : 'Start';
      const over = $(`btn${key}New`);
      over.hidden = !run;
      over.textContent = 'Start over';
      armed[game] = 0;
      let status;
      if (game === 'survival') {
        status = run ? `Saved at level ${run.level} · ${plural(run.lives, 'life', 'lives')} left`
          : stats.highest ? `Best: level ${stats.highest}` : 'Not played yet';
      } else {
        status = run ? `Saved at level ${run.level} · ${plural(run.used, 'life', 'lives')} used`
          : stats.mBest ? `Best: ${plural(stats.mBest, 'life', 'lives')}` : stats.mFurthest ? `Furthest: level ${stats.mFurthest}` : 'Not played yet';
      }
      $(`${game}Status`).textContent = status;
    }
    $('stHighest').textContent = stats.highest || '—';
    $('stMarathon').textContent = stats.mBest ? stats.mBest.toLocaleString('en-GB') : '—';
    $('stDist').textContent = fmtDist(stats.metres);
    $('stAvg').textContent = stats.deaths ? fmtDist(avgLife()) : '—';
    const pl = O.player;
    $('playerLine').hidden = !O.online;
    $('raceCard').hidden = !O.online;
    $('playerText').textContent = pl ? `Ranked as ${pl.nickname}.` : 'Leaderboards are on. Pick a name to get ranked.';
    $('btnName').textContent = pl ? 'Change name' : 'Pick a name';
    $('btnBoards').hidden = !O.online;
    $('btnOverBoards').hidden = !O.online;
    S.highestBefore = stats.highest;
    $('titleVex').textContent = V.title(vexCtx());
  }

  function startOver(game) {
    const run = readRun(game);
    const key = game === 'survival' ? 'Survival' : 'Marathon';
    if (!run || armed[game]) { requestStart(game, true); return; }
    armed[game] = 1;
    $(`btn${key}New`).textContent = `Tap again to end your level ${run.level} run`;
    setTimeout(() => { if (armed[game] && S.mode === 'title') refreshTitle(); }, 3000);
  }

  /* ---------- attract mode: a bot plays behind the menus ---------- */

  const ATTRACT = [14, 27, 36, 45, 58, 66, 84, 23, 52, 95];
  function startAttract() {
    const n = ATTRACT[S.attractI++ % ATTRACT.length];
    store.load(n, (lv) => {
      if (!MENU[S.mode]) return;
      S.attract = { lv, p: G.newRunner(lv, 0.3), trig: G.botTriggers(lv, () => 0.35), end: 0 };
      setPalette(lv.world, true);
      trail.length = 0;
      snapCam = true;
    });
  }

  function stepAttract(dt) {
    const A = S.attract;
    if (!A) return;
    if (A.p.dead || A.p.won) {
      A.end += dt;
      if (A.p.won) { A.p.t += dt; A.p.s = G.sAt(A.lv, A.p.t); }
      if (A.end > 0.8 && A.end - dt <= 0.8) startAttract();
      return;
    }
    G.advance(A.lv, A.p, dt, A.trig);
  }

  /* ---------- input ---------- */

  function press(dir, padEl) {
    if (padEl) {
      padEl.classList.add('on');
      setTimeout(() => padEl.classList.remove('on'), 110);
    }
    if (S.mode !== 'play' || S.hold > 0 || S.p.t < -0.3) return;
    stats.hops++;
    S.inputs.push(dir);   // applied on the next tick, so the hop log matches the replay exactly
  }

  const padL = $('padLeft'), padR = $('padRight');
  padL.addEventListener('pointerdown', (e) => { e.preventDefault(); press(-1, padL); });
  padR.addEventListener('pointerdown', (e) => { e.preventDefault(); press(1, padR); });
  for (const el of [padL, padR]) el.addEventListener('contextmenu', (e) => e.preventDefault());

  /* Frame-time readout (press F). window.WHGDebug exposes the same numbers. */
  const perfEl = $('perf');
  const perf = { fps: 60, jsMs: 0, scale: 1, shown: false, next: 0 };
  window.WHGDebug = perf;
  perf.state = S;   // for poking at the game from the browser console

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.target && e.target.tagName === 'INPUT') return;   // typing a name
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { press(-1, padL); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { press(1, padR); e.preventDefault(); }
    else if (k === 'f' || k === 'F') { perf.shown = !perf.shown; perfEl.hidden = !perf.shown; }
    else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (S.mode === 'play') pause();
      else if (S.mode === 'paused') resume();
      else if (S.mode === 'stats') closeStats();
      else if (S.mode === 'boards') closeBoards();
      else if (S.mode === 'name') skipName();
    }
  });

  $('btnSurvival').addEventListener('click', () => requestStart('survival', false));
  $('btnMarathon').addEventListener('click', () => requestStart('marathon', false));
  $('btnName').addEventListener('click', () => openName());
  $('btnHost').addEventListener('click', hostRace);
  $('btnJoin').addEventListener('click', openJoin);
  $('joinForm').addEventListener('submit', submitJoin);
  $('btnJoinBack').addEventListener('click', toTitle);
  $('btnRaceGo').addEventListener('click', () => RC.start());
  $('btnLobbyLeave').addEventListener('click', toTitle);
  $('btnRaceAgain').addEventListener('click', () => RC.again());
  $('btnRaceLeave').addEventListener('click', toTitle);
  for (const id of ['raceStart', 'raceLength', 'raceCheckpoint']) $(id).addEventListener('change', changeRaceSettings);
  for (let n = 1; n <= G.LEVEL_COUNT; n += 10) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = `Level ${n} \u00b7 ${G.WORLDS[Math.floor((n - 1) / 10)].name}`;
    $('raceStart').append(opt);
  }
  $('nameForm').addEventListener('submit', submitName);
  $('btnNameSkip').addEventListener('click', skipName);
  $('btnBoards').addEventListener('click', openBoards);
  $('btnOverBoards').addEventListener('click', openBoards);
  $('btnBoardsBack').addEventListener('click', closeBoards);
  for (const t of document.querySelectorAll('#boardTabs [data-board]')) t.addEventListener('click', () => loadBoard(t.dataset.board));
  $('btnSurvivalNew').addEventListener('click', () => startOver('survival'));
  $('btnMarathonNew').addEventListener('click', () => startOver('marathon'));
  $('btnStats').addEventListener('click', openStats);
  $('btnOverStats').addEventListener('click', openStats);
  $('btnStatsBack').addEventListener('click', closeStats);
  $('pauseBtn').addEventListener('click', pause);
  $('btnResume').addEventListener('click', resume);
  $('btnQuit').addEventListener('click', toTitle);
  $('btnAgain').addEventListener('click', () => requestStart('survival', true));
  $('btnOverTitle').addEventListener('click', toTitle);
  $('btnWinAgain').addEventListener('click', () => requestStart(S.game, true));
  $('btnWinTitle').addEventListener('click', toTitle);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (S.mode === 'play') pause();
      else if (S.mode === 'dying' || S.mode === 'clear') { saveRun(); saveStats(); }
    } else {
      if (S.mode === 'play') requestWake();
      if (S.race && S.race.room && !RC.connected) rejoinRace();
    }
  });
  window.addEventListener('resize', () => { resize(); snapCam = true; });
  window.addEventListener('pagehide', () => {
    if (S.mode === 'play' || S.mode === 'paused') saveRun();
    saveStats();
  });

  /* ---------- main loop ---------- */

  function update(dt) {
    switch (S.mode) {
      case 'play': {
        S.runTime += dt;
        stats.playTime += dt;
        if (S.hold > 0) {
          S.hold -= dt;
          if (S.hold <= 0) hideBanner();
          break;
        }
        // Whole ticks only, with queued hops applied (and logged) at the start of a tick.
        S.acc += dt;
        const tick = 1 / G.TICK_RATE;
        if (routeLane === null) routeLane = V.committedLane(S.p);
        while (S.acc >= tick && !S.p.dead && !S.p.won) {
          if (S.inputs.length) {
            for (const d of S.inputs) { G.hop(S.lv, S.p, d); S.log.push([S.p.tick, d]); }
            S.inputs.length = 0;
          }
          G.stepRunner(S.lv, S.p);
          S.acc -= tick;
          if (!S.p.dead) {
            const nowLane = V.committedLane(S.p);
            if (nowLane !== routeLane) {
              const miss = V.routeWrong(S.lv, S.p, nowLane);
              if (miss) roastRoute(miss);
              routeLane = nowLane;
            }
          }
        }
        if (banner.classList.contains('show') && S.p.t >= S.bannerUntil) hideBanner();
        if (S.p.dead) onDeath();
        else if (S.p.won) onLevelDone();
        break;
      }
      case 'dying':
        S.runTime += dt;
        stats.playTime += dt;
        S.deathClock += dt;
        S.timer -= dt;
        if (S.timer <= 0) afterDeath();
        break;
      case 'clear':
        S.runTime += dt;
        S.p.t += dt;
        S.p.s = G.sAt(S.lv, S.p.t);
        S.timer -= dt;
        if (S.timer <= 0) {
          if (S.game !== 'race') winRun();
          else if (S.race && S.race.result) showRaceEnd();   // otherwise keep coasting until the result arrives
        }
        break;
      case 'title':
      case 'over':
      case 'win':
      case 'stats':
        stepAttract(dt);
        break;
      default:
        break;
    }
    if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 1.6);
  }

  let last = 0;
  function frame(now) {
    const t0 = performance.now();
    const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0;
    adaptQuality(last ? (now - last) / 1000 : 0, now);
    last = now;
    update(dt);
    tickCue();
    const view = MENU[S.mode] || !S.lv ? S.attract : S;
    if (view && view.lv) updateCamera(view.lv, view.p, dt, view === S);
    updateFx(view, dt, now);
    render(view, dt);
    if (!MENU[S.mode] && S.lv) tickHud();
    if (S.game === 'race' && S.race && S.p && !MENU[S.mode]) sendRacePos(now);
    tickVex(now);
    perf.jsMs += (performance.now() - t0 - perf.jsMs) * 0.1;
    if (dt > 0) perf.fps += (1 / dt - perf.fps) * 0.1;
    perf.scale = canvas.width / W;
    if (perf.shown && now > perf.next) {
      perf.next = now + 250;
      perfEl.textContent = `${perf.fps.toFixed(0)} fps · ${perf.jsMs.toFixed(1)} ms js · ${perf.scale.toFixed(2)}x`;
    }
    requestAnimationFrame(frame);
  }

  function boot() {
    resize();
    refreshTitle();
    showScreen('scrTitle');
    if (!R) {
      $('titleVex').textContent = 'This game draws with WebGL, and this browser has it switched off. Try another browser, or turn on hardware acceleration.';
      $('btnSurvival').disabled = true;
      $('btnMarathon').disabled = true;
      return;
    }
    startAttract();
    requestAnimationFrame(frame);
    O.check().then(() => { if (S.mode === 'title') refreshTitle(); });
    if ('serviceWorker' in navigator && document.querySelector('link[rel="manifest"]') &&
        (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(boot); else boot();
})();
