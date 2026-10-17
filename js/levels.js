/* World's Hardest Game: level generator and run simulation.
   Pure logic with no DOM access, so tools/verify-levels.js can load it in Node.

   Coordinates: every level is a curved centre line. A point on the track is
   (s, u): s is distance along the line, u is sideways offset (positive = the
   dot's right). Lanes are numbered 0..lanes-1 from the dot's left. */
(function (root) {
  'use strict';

  const LEVEL_COUNT = 100;
  const LANE_SPACING = 62;   // world units between neighbouring lanes
  const PLAYER_R = 9;
  const HOP_TIME = 0.12;     // seconds to hop one lane
  const TICK_RATE = 240;     // the simulation always moves in steps of exactly 1/240 s
  // Bump whenever level generation or the simulation changes: the leaderboard
  // server only ranks runs played on the same version it has.
  const VERSION = '2026-10-08.1';
  const DS = 4;              // spacing of precomputed track samples
  const TRACK_S0 = -1500;    // track and lanes start this far behind the start line
  const BUCKET = 160;        // hazard lookup bucket length
  const LASER_HALF = 3;
  const SWEEPER_HALF = 5;
  const SLIDER_R = 13;
  const RESERVE_PAD = 26;    // planned lanes stay intact this far past each end
  const CHECK_M = 10;        // extra clearance (units) the planned route keeps from hazards
  const CHECK_TM = 0.08;     // extra clearance (seconds) the planned route keeps from blinking hazards
  const SPEED_CAP = 760;
  const FORK_SPREAD = 0.6;   // how far (in lanes) each side of a split pulls apart

  const WORLDS = [
    { name: 'First Steps', hue: 186, sat: 100 },
    { name: 'Bends', hue: 205, sat: 100 },
    { name: 'Lasers', hue: 232, sat: 100 },
    { name: 'Sweepers', hue: 168, sat: 100 },
    { name: 'Drift', hue: 255, sat: 100 },
    { name: 'Spin', hue: 145, sat: 90 },
    { name: 'Mirror', hue: 280, sat: 100 },
    { name: 'Rush', hue: 196, sat: 100 },
    { name: 'Compass', hue: 215, sat: 70 },
    { name: 'The Hardest', hue: 45, sat: 0 },
  ];

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const frac = (x) => x - Math.floor(x);
  const smooth = (x) => x * x * (3 - 2 * x);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* How hard level n is. Starts at 0.05 and climbs steeply, so level 2 sits
     where a gentle curve would put level 10, and keeps going past 1 late on. */
  function difficulty(n) {
    return 0.12 + 1.25 * Math.pow((n - 1) / (LEVEL_COUNT - 1), 0.5);
  }

  /* Base speed of level n and how much it speeds up by its finish line. */
  function baseSpeed(n) {
    const D = difficulty(n), w = Math.min(9, Math.floor((n - 1) / 10));
    return { v0: Math.round(190 + 240 * Math.min(D, 1.35) + (w >= 7 ? 40 : 0)), ramp: 0.12 + 0.15 * Math.min(1, D) };
  }

  /* Speed as level n crosses its finish line, which the next level starts at. */
  function finishSpeed(n) {
    const b = baseSpeed(n);
    return Math.min(SPEED_CAP, b.v0 * (1 + b.ramp));
  }

  /* Lane hops level n needs: 17 at level 1, 30 at level 10, 146 at level 100.
     Strictly increasing, so every level asks for more presses than the last. */
  function hopsFor(n) {
    return 16 + n + Math.round(30 * Math.pow((n - 1) / (LEVEL_COUNT - 1), 0.8));
  }

  /* ---------- lane pieces: sorted [start, end] intervals where a lane exists ---------- */

  function cut(ivs, a, b) {
    const out = [];
    for (const iv of ivs) {
      if (iv[1] <= a || iv[0] >= b) { out.push(iv); continue; }
      if (iv[0] < a) out.push([iv[0], a]);
      if (iv[1] > b) out.push([b, iv[1]]);
    }
    return out;
  }

  function restore(ivs, a, b) {
    const all = ivs.concat([[a, b]]).sort((p, q) => p[0] - q[0]);
    const out = [];
    for (const iv of all) {
      const prev = out[out.length - 1];
      if (prev && iv[0] <= prev[1]) prev[1] = Math.max(prev[1], iv[1]);
      else out.push([iv[0], iv[1]]);
    }
    return out;
  }

  function overlaps(ivs, a, b) {
    for (const iv of ivs) if (iv[0] < b && iv[1] > a) return true;
    return false;
  }

  /* ---------- track geometry ---------- */

  function boxBlur(src, r) {
    const n = src.length;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - r), b = Math.min(n, i + r + 1);
      out[i] = (pre[b] - pre[a]) / (b - a);
    }
    return out;
  }

  function buildTrack(lv, rng, curve) {
    const n = Math.ceil((lv.length + 2200 - TRACK_S0) / DS) + 2;
    let kap = new Float64Array(n);
    if (curve) {
      let s = curve.start;
      let sign = rng() < 0.5 ? -1 : 1;
      const end = TRACK_S0 + n * DS;
      while (s < end) {
        const len = lerp(curve.minLen, curve.maxLen, rng());
        let k = 0;
        if (rng() > curve.straight) {
          if (rng() < curve.flip) sign = -sign;
          k = sign * lerp(curve.kMin, curve.kMax, rng());
        }
        const i0 = Math.max(0, Math.floor((s - TRACK_S0) / DS));
        const i1 = Math.min(n, Math.ceil((s + len - TRACK_S0) / DS));
        for (let i = i0; i < i1; i++) kap[i] = k;
        s += len;
      }
      kap = boxBlur(boxBlur(kap, 15), 15);
    }
    const x = new Float64Array(n), y = new Float64Array(n), th = new Float64Array(n);
    let px = 0, py = 0, a = -Math.PI / 2;
    for (let i = 0; i < n; i++) {
      x[i] = px; y[i] = py; th[i] = a;
      const mid = a + kap[i] * DS * 0.5;
      px += Math.cos(mid) * DS;
      py += Math.sin(mid) * DS;
      a += kap[i] * DS;
    }
    lv.track = { n, x, y, th };
  }

  function trackPoint(lv, s, out) {
    const tr = lv.track;
    let f = (s - TRACK_S0) / DS;
    if (f < 0) f = 0; else if (f > tr.n - 1.0001) f = tr.n - 1.0001;
    const i = f | 0, r = f - i;
    out.x = tr.x[i] + (tr.x[i + 1] - tr.x[i]) * r;
    out.y = tr.y[i] + (tr.y[i + 1] - tr.y[i]) * r;
    out.th = tr.th[i] + (tr.th[i + 1] - tr.th[i]) * r;
    return out;
  }

  const TP = { x: 0, y: 0, th: 0 };

  function headingAt(lv, s) {
    return trackPoint(lv, s, TP).th;
  }

  /* World position of track point (s, u). Writes x, y and the track heading into out. */
  function place(lv, s, u, out) {
    trackPoint(lv, s, TP);
    out.x = TP.x - Math.sin(TP.th) * u;
    out.y = TP.y + Math.cos(TP.th) * u;
    out.th = TP.th;
    return out;
  }

  function laneSpacing(lv, s, t) {
    const dr = lv.drift;
    return dr ? LANE_SPACING * (1 + dr.b * Math.sin(s * dr.fs + t * dr.ft + dr.p1)) : LANE_SPACING;
  }

  /* Extra sideways push while the track is split: each side of the missing lane pulls apart. */
  function forkShift(lv, l, s) {
    let u = 0;
    for (const f of lv.forks) {
      if (s <= f.s0 || s >= f.s1) continue;
      const k = smooth(clamp((s - f.s0) / f.ramp, 0, 1)) * smooth(clamp((f.s1 - s) / f.ramp, 0, 1));
      u += FORK_SPREAD * LANE_SPACING * k * clamp(l - f.x, -1, 1);
    }
    return u;
  }

  /* Sideways offset of (fractional) lane l at distance s and time t. */
  function laneU(lv, l, s, t) {
    const c = (lv.lanes - 1) / 2, dr = lv.drift;
    let u = dr
      ? (l - c) * laneSpacing(lv, s, t) + dr.a * Math.sin(s * dr.fs2 + t * dr.ft2 + dr.p2)
      : (l - c) * LANE_SPACING;
    if (lv.forks.length) u += forkShift(lv, l, s);
    return u;
  }

  function laneExists(lv, x, s) {
    if (x < 0 || x >= lv.lanes) return false;
    const ivs = lv.laneIv[x];
    for (let i = 0; i < ivs.length; i++) if (s >= ivs[i][0] && s <= ivs[i][1]) return true;
    return false;
  }

  /* ---------- speed and time ---------- */

  /* Extra speed from surges at s, as a fraction (0.5 = 50% faster). Each surge eases in,
     holds, and eases out over its length. */
  function surgeBoost(surges, s) {
    let boost = 0;
    for (const e of surges) {
      if (s <= e.s || s >= e.s + e.len) continue;
      const edge = Math.min(e.len * 0.25, 260);
      boost += e.amt * smooth(clamp((s - e.s) / edge, 0, 1)) * smooth(clamp((e.s + e.len - s) / edge, 0, 1));
    }
    return boost;
  }

  /* Speed at distance s: a base speed that climbs through the level, plus surges. */
  function speedAt(lv, s) {
    const sp = lv.speedProfile;
    let v = sp.v0 * (1 + sp.ramp * clamp(s / lv.length, 0, 1));
    // Levels run into each other: start at the speed the last level finished on.
    if (s < sp.blend) v += (sp.carry - sp.v0) * (1 - smooth(clamp(s / sp.blend, 0, 1)));
    return Math.min(SPEED_CAP, v * (1 + surgeBoost(sp.surges, s)));
  }

  function buildTiming(lv) {
    const n = Math.ceil((lv.length + 2200) / DS) + 2;
    const T = new Float64Array(n);
    for (let i = 1; i < n; i++) T[i] = T[i - 1] + DS / speedAt(lv, (i - 0.5) * DS);
    lv.timing = T;
  }

  /* Seconds after the start when the dot reaches s. */
  function timeAt(lv, s) {
    if (s <= 0) return 0;
    const T = lv.timing, f = s / DS, i = Math.floor(f);
    if (i >= T.length - 1) return T[T.length - 1] + (s - (T.length - 1) * DS) / speedAt(lv, s);
    return T[i] + (T[i + 1] - T[i]) * (f - i);
  }

  /* Where the dot is t seconds after the start. Exact inverse of timeAt. */
  function sAt(lv, t) {
    if (t <= 0) return 0;
    const T = lv.timing, n = T.length;
    if (t >= T[n - 1]) return (n - 1) * DS + (t - T[n - 1]) * speedAt(lv, (n - 1) * DS);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (T[mid] <= t) lo = mid; else hi = mid;
    }
    return (lo + (t - T[lo]) / (T[hi] - T[lo])) * DS;
  }

  /* ---------- hazards ---------- */

  function laserOn(h, t) {
    return h.period === 0 || frac(t / h.period + h.phase) < h.on;
  }

  /* True while a blinking laser is off but turns on within `lead` seconds. */
  function laserWarning(h, t, lead) {
    if (h.period === 0) return false;
    const x = frac(t / h.period + h.phase);
    return x >= h.on && (1 - x) * h.period < lead;
  }

  /* Sweeper bar end points in (s, u): out = [sA, uA, sB, uB]. */
  function sweeperEnds(lv, h, t, out) {
    const uc = laneU(lv, h.l, h.s, t), a = h.w * t + h.ph;
    const cs = Math.cos(a) * h.len, sn = Math.sin(a) * h.len;
    out[0] = h.s - cs; out[1] = uc - sn;
    out[2] = h.s + cs; out[3] = uc + sn;
    return out;
  }

  function sliderLane(h, t) {
    return h.l + h.amp * Math.sin(h.w * t + h.ph);
  }

  function segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let k = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const ex = ax + dx * k - px, ey = ay + dy * k - py;
    return ex * ex + ey * ey;
  }

  const SEG = [0, 0, 0, 0];

  function hitsAt(lv, h, s, l, t, m) {
    if (h.type === 'laser') {
      if (Math.abs(s - h.s) > PLAYER_R + LASER_HALF + m) return false;
      const up = laneU(lv, l, h.s, t), pad = PLAYER_R + m;
      if (up < laneU(lv, h.a - 0.5, h.s, t) - pad || up > laneU(lv, h.b + 0.5, h.s, t) + pad) return false;
      return laserOn(h, t);
    }
    const u = laneU(lv, l, s, t);
    if (h.type === 'sweeper') {
      if (Math.abs(s - h.s) > h.len + SWEEPER_HALF + PLAYER_R + m) return false;
      sweeperEnds(lv, h, t, SEG);
      const r = PLAYER_R + SWEEPER_HALF + m;
      return segDist2(s, u, SEG[0], SEG[1], SEG[2], SEG[3]) < r * r;
    }
    const r = PLAYER_R + SLIDER_R + m;
    const ds = s - h.s;
    if (Math.abs(ds) > r) return false;
    const du = u - laneU(lv, sliderLane(h, t), h.s, t);
    return ds * ds + du * du < r * r;
  }

  /* m widens every hazard by m units; tm also checks tm seconds either side of t. */
  function hazardHits(lv, h, s, l, t, m, tm) {
    if (hitsAt(lv, h, s, l, t, m)) return true;
    if (!tm) return false;
    return hitsAt(lv, h, s, l, t - tm, m) || hitsAt(lv, h, s, l, t + tm, m) ||
      hitsAt(lv, h, s, l, t - tm / 2, m) || hitsAt(lv, h, s, l, t + tm / 2, m);
  }

  function hazardExtent(h) {
    if (h.type === 'laser') { h.e0 = h.s - LASER_HALF; h.e1 = h.s + LASER_HALF; }
    else if (h.type === 'sweeper') { h.e0 = h.s - h.len - SWEEPER_HALF; h.e1 = h.s + h.len + SWEEPER_HALF; }
    else { h.e0 = h.s - SLIDER_R; h.e1 = h.s + SLIDER_R; }
  }

  function buildBuckets(lv) {
    lv.hazards.sort((a, b) => a.s - b.s);
    lv.buckets = [];
    for (const h of lv.hazards) {
      const i0 = Math.max(0, Math.floor((h.e0 - 40 - TRACK_S0) / BUCKET));
      const i1 = Math.floor((h.e1 + 40 - TRACK_S0) / BUCKET);
      for (let i = i0; i <= i1; i++) (lv.buckets[i] || (lv.buckets[i] = [])).push(h);
    }
  }

  /* The hazard touching a dot at (s, lane l) at time t, or null. */
  function dangerAt(lv, s, l, t, m, tm) {
    const b = lv.buckets[Math.floor((s - TRACK_S0) / BUCKET)];
    if (!b) return null;
    for (let i = 0; i < b.length; i++) if (hazardHits(lv, b[i], s, l, t, m || 0, tm || 0)) return b[i];
    return null;
  }

  /* Index of the first hazard whose position is at or after s (hazards are sorted by s). */
  function firstHazardFrom(lv, s) {
    const hz = lv.hazards;
    let lo = 0, hi = hz.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (hz[mid].s < s) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /* ---------- camera script ---------- */

  function camAt(lv, s, out) {
    const c = lv.cam;
    let rot = 0, flip = 0, zoom = 1, tilt = lv.view ? lv.view.tilt : 0;
    for (const e of c.dives || []) if (s > e.s && s < e.s + e.len) tilt += e.amt * smooth(clamp((s - e.s) / (e.len * 0.25), 0, 1)) * smooth(clamp((e.s + e.len - s) / (e.len * 0.25), 0, 1));
    for (const e of c.spins) { if (s <= e.s) break; rot += e.a * smooth(clamp((s - e.s) / e.len, 0, 1)); }
    for (const e of c.flips) { if (s <= e.s) break; flip += smooth(clamp((s - e.s) / e.len, 0, 1)); }
    for (const e of c.zooms) if (s > e.s && s < e.s + e.len) zoom *= 1 + e.amt * Math.sin((Math.PI * (s - e.s)) / e.len);
    let head = headingAt(lv, s + 30);
    for (const e of c.locks) {
      if (s <= e.s0 || s >= e.s1 + e.blend) continue;
      const wIn = smooth(clamp((s - e.s0) / e.blend, 0, 1));
      const wOut = 1 - smooth(clamp((s - e.s1) / e.blend, 0, 1));
      const near = s < e.s1 ? head : head - Math.PI * 2 * e.k;
      head = near + (e.h - near) * Math.min(wIn, wOut);
    }
    out.rot = rot;
    out.tilt = clamp(tilt, 0, 0.97);
    out.mirror = Math.cos(Math.PI * flip);
    out.zoom = zoom;
    out.head = head;
    return out;
  }

  const CS_TMP = { rot: 0, mirror: 1, zoom: 1, head: 0 };

  /* True when the dot's left points right on screen at s (spun or mirrored view). */
  function controlsReversedAt(lv, s) {
    camAt(lv, s, CS_TMP);
    const th = headingAt(lv, s);
    const alpha = -Math.PI / 2 - CS_TMP.head + CS_TMP.rot;
    return Math.cos(th - Math.PI / 2 + alpha) * (CS_TMP.mirror < 0 ? -1 : 1) > 0.35;
  }

  /* ---------- level generation ---------- */

  /* How the camera sees level n: tilt (0 = straight down, 1 = low chase camera),
     hills (rise and fall of the track, purely visual) and haze (how quickly the
     track fades ahead, 0 = none). Uses its own random seed so the track layout
     doesn't change with it. Flat for levels 1-5, tilting from 6, hills from 11. */
  function viewFor(n) {
    const rng = mulberry32((Math.imul(n, 2246822519) ^ 0x51ed27) >>> 0);
    const R = (a, b) => a + (b - a) * rng();
    const w = Math.min(9, Math.floor((n - 1) / 10)), k = ((n - 1) % 10) / 9;
    if (n <= 5) return { tilt: 0, hills: null, haze: 0 };
    if (w === 0) return { tilt: lerp(0.18, 0.36, (n - 6) / 4), hills: null, haze: 0.1 };
    const tilt = [0, lerp(0.42, 0.55, k), 0.6, 0.64, 0.68, 0.72, 0.74, 0.77, 0.8, 0.84][w];
    const a = [0, lerp(45, 95, k), 100, 112, 124, 136, 146, 154, 164, 178][w];
    const haze = [0, lerp(0.25, 0.45, k), 0.5, 0.55, 0.6, 0.66, 0.7, 0.75, 0.8, 0.86][w];
    const l1 = R(900, 1500), l2 = R(420, 760);
    return { tilt, haze, hills: { a, k1: (Math.PI * 2) / l1, k2: (Math.PI * 2) / l2, p1: R(0, 6.28), p2: R(0, 6.28) } };
  }

  /* Height of the track at s. Flat at the start and finish so levels join cleanly. */
  function heightAt(lv, s) {
    const hl = lv.view && lv.view.hills;
    if (!hl || s <= 0 || s >= lv.length) return 0;
    const env = smooth(clamp(s / 500, 0, 1)) * smooth(clamp((lv.length - s) / 400, 0, 1));
    return hl.a * env * (0.65 * Math.sin(s * hl.k1 + hl.p1) + 0.35 * Math.sin(s * hl.k2 + hl.p2));
  }

  function levelInfo(n) {
    const w = Math.min(9, Math.floor((n - 1) / 10));
    return { world: w, name: WORLDS[w].name, firstOfWorld: (n - 1) % 10 === 0 };
  }

  /* Every level is built around a planned route. The route changes lane every
     section; each section has a hop window (lanes between the old and new lane
     stay clear) followed by an obstacle that blocks every other lane. While the
     track is split, the route stays on the side that continues; the other side
     dead-ends. Planned spots are reserved: gaps never cut them and every hazard
     is checked against them with extra clearance, so each level is beatable. */
  function generateLevel(n) {
    n = clamp(n | 0, 1, LEVEL_COUNT);
    const rng = mulberry32((0x9e3779b1 ^ Math.imul(n, 2654435761)) >>> 0);
    const R = (a, b) => a + (b - a) * rng();
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const d = (n - 1) / (LEVEL_COUNT - 1);   // linear progress through the game
    const D = difficulty(n);                 // how hard this level is
    const Dc = Math.min(1, D);
    const info = levelInfo(n);
    const w = info.world;
    const k = ((n - 1) % 10) / 9;

    let lanes;
    if (n === 1) lanes = 3;
    else if (n <= 3) lanes = 4;
    else if (n <= 9) lanes = rng() < 0.35 ? 4 : 5;
    else if (n <= 29) lanes = rng() < 0.5 ? 5 : 6;
    else lanes = pick([5, 6, 6, 7, 7]);

    const { v0, ramp } = baseSpeed(n);
    const carry = n > 1 ? finishSpeed(n - 1) : v0;
    const hopTarget = hopsFor(n);

    const lv = {
      n, world: w, name: info.name, difficulty: D, speed: v0, lanes, length: 0, hopTarget,
      startLane: Math.floor((lanes - 1) / 2),
      speedProfile: { v0, ramp, cap: SPEED_CAP, surges: [], carry, blend: v0 * 1.2 + 120 },
      laneIv: [], hazards: [], buckets: [], route: [], forks: [], deadEnds: [], events: [],
      drift: null, cam: { spins: [], flips: [], zooms: [], locks: [], dives: [] }, view: viewFor(n), track: null, timing: null, repairs: 0,
    };

    /* --- plan the route: keep adding sections until the level has its hops --- */
    const tWin = Math.max(0.26, 0.78 - 0.6 * Math.pow(Math.min(D, 1.1), 0.75));
    const tCalm = Math.max(0, 0.15 - 0.35 * D);
    const tObs = lerp(1.1, 0.75, Dc);
    const pOpen = n === 1 ? 0.05 : 0;
    const pLong = lerp(0.12, 0.04, Dc);
    const p2 = n === 1 ? 0.35 : lerp(0.5, 0.85, Dc);
    const p3 = n >= 5 && lanes >= 5 ? lerp(0.2, 0.6, Dc) : 0;
    const runway = v0 * 1.2 + 120;
    // Rough level length, only used to pace the speed-up while planning.
    const lenGuess = v0 * (1 + ramp / 2) * (hopTarget / lerp(0.7, 2.5, Math.pow(Dc, 0.9)) + 2.5);
    // Planning speed includes surges as they're placed, so hop windows account for them.
    const vPlan = (s) => Math.min(SPEED_CAP, v0 * (1 + ramp * clamp(s / lenGuess, 0, 1)) * (1 + surgeBoost(lv.speedProfile.surges, s)));
    const rects = [];     // reserved {l0, l1, s0, s1}: the dot may be anywhere in lanes l0..l1 over s0..s1
    const obstacles = [];

    // Which sections start a split.
    const secGuess = Math.round(hopTarget / (1 + 0.5 * p2 + 0.5 * p3));
    let nForks = 0;
    if (n >= 2 && lanes >= 4) nForks = n <= 5 ? 1 : n <= 20 ? 1 + (rng() < 0.5 ? 1 : 0) : 2 + (rng() < Dc * 0.6 ? 1 : 0) + (w === 9 ? 1 : 0);
    const forkAt = [];
    for (let i = 0; i < nForks; i++) forkAt.push(Math.round(lerp(3, Math.max(4, secGuess - 5), (i + R(0.15, 0.85)) / nForks)));
    forkAt.sort((a, b) => a - b);

    // Which sections start a speed surge. The first is a taste; every later one
    // lasts about twice as long and pushes 45-75% faster.
    let nSurge = 0;
    if (n >= 4) nSurge = 1 + (n >= 6 ? 1 : 0) + (n >= 12 ? 1 : 0) + (n >= 30 && rng() < 0.5 ? 1 : 0) + (w >= 7 ? 1 : 0);
    const surgeAt = [];
    for (let i = 0; i < nSurge; i++) surgeAt.push(Math.round(lerp(2, Math.max(3, secGuess - 4), (i + R(0.1, 0.6)) / nSurge)));
    surgeAt.sort((a, b) => a - b);
    let sq = 0;

    function makeFork(r) {
      const choices = [];
      for (let x = 1; x <= lanes - 2; x++) {
        if (x >= 2) choices.push({ x, side: 'left', good: [0, x - 1], bad: [x + 1, lanes - 1] });
        if (lanes - 1 - x >= 2) choices.push({ x, side: 'right', good: [x + 1, lanes - 1], bad: [0, x - 1] });
      }
      if (!choices.length) return null;
      // Usually make the safe side the one the dot isn't on, so the split costs hops.
      const away = choices.filter((c) => r < c.good[0] || r > c.good[1]);
      const c = away.length && rng() < 0.65 ? pick(away) : pick(choices);
      c.left = n <= 5 ? 2 : 2 + Math.floor(rng() * 3);
      return c;
    }

    let r = lv.startLane, stayStart = TRACK_S0, s = runway, hops = 0;
    let fork = null, fq = 0;
    while (hops < hopTarget) {
      const remaining = hopTarget - hops;
      if (sq < surgeAt.length && lv.route.length >= surgeAt[sq] && remaining > 6) {
        const vNow = vPlan(s), first = sq === 0;
        lv.speedProfile.surges.push({
          s, n: sq + 1,
          len: vNow * (first ? R(2.5, 4.0) : R(5.0, 8.0)),
          amt: first ? R(0.18, 0.3) + 0.1 * Dc : R(0.45, 0.6) + 0.15 * Dc,
        });
        sq++;
      }
      const v = vPlan(s);
      let entering = false;
      if (!fork && fq < forkAt.length && lv.route.length >= forkAt[fq]) {
        fq++;
        if (remaining >= lanes + 2) { fork = makeFork(r); entering = !!fork; }
      }
      const lo = fork ? fork.good[0] : 0, hi = fork ? fork.good[1] : lanes - 1;
      const maxShift = Math.min(remaining, rng() < p3 ? 3 : rng() < p2 ? 2 : 1);
      const opts = [];
      for (let x = lo; x <= hi; x++) {
        const dd = Math.abs(x - r);
        if (dd >= 1 && dd <= maxShift) opts.push(x);
      }
      const to = opts.length ? pick(opts) : r < lo ? lo : r > hi ? hi : r === lo ? r + 1 : r - 1;
      const steps = Math.abs(to - r);
      const hopLen = v * HOP_TIME;
      const W = v * tWin * R(1, 1.25) + hopLen * Math.max(0, steps - 1) * 1.6;
      const O = hopLen * steps + v * (R(0.2, 0.4) * tObs + (rng() < pLong ? R(0.3, 0.6) : 0));
      const h0 = s, h1 = s + W, b = h1 + O;
      const aEff = h1 + hopLen * steps + 8;
      rects.push({ l0: r, l1: r, s0: stayStart, s1: h1 });
      if (steps) rects.push({ l0: Math.min(r, to), l1: Math.max(r, to), s0: h0, s1: aEff - 2 });
      lv.route.push({ h0, h1, from: r, to });
      if (entering) fork.f0 = aEff + 28;

      const open = new Set([to]);
      for (let x = lo; x <= hi; x++) if (x !== to && rng() < pOpen) open.add(x);
      if (open.size === hi - lo + 1) open.delete(pick([...open].filter((x) => x !== to)));
      const blocked = [];
      for (let x = lo; x <= hi; x++) if (!open.has(x)) blocked.push(x);
      const calm = v * tCalm * R(0.6, 1.4);
      obstacles.push({ h0, a: h1, aEff, b, open, blocked, to, calm, lo, hi });
      hops += steps;
      stayStart = h0;
      r = to;
      s = b + calm;
      if (fork && (--fork.left <= 0 || hops >= hopTarget)) { fork.f1 = s - 30; lv.forks.push(fork); fork = null; }
    }
    const length = Math.round(s + vPlan(s) * 1.1);
    lv.length = length;
    rects.push({ l0: r, l1: r, s0: stayStart, s1: length + 2000 });
    lv.forks = lv.forks.filter((f) => f.f1 - f.f0 > vPlan(f.f0) * 1.0);
    for (const f of lv.forks) {
      f.s0 = f.f0;
      f.s1 = f.f1;
      f.ramp = Math.min(220, (f.s1 - f.s0) / 3);
    }

    // Every surge is over before the finish, so the next level starts at the expected speed.
    for (const e of lv.speedProfile.surges) e.len = Math.min(e.len, length - v0 * 1.2 - e.s);
    lv.speedProfile.surges = lv.speedProfile.surges.filter((e) => e.len > v0);
    buildTiming(lv);
    const vAt = (s2) => speedAt(lv, s2);
    const tAt = (s2) => timeAt(lv, s2);

    if (w >= 4 && (w === 4 || rng() < 0.6)) {
      const strength = w === 4 ? lerp(0.5, 1, k) : R(0.5, 1);
      lv.drift = {
        a: R(10, 26) * strength, b: R(0.07, 0.18) * strength,
        fs: R(0.002, 0.005), ft: R(0.6, 1.3), p1: R(0, 6.28),
        fs2: R(0.0015, 0.004), ft2: R(0.5, 1.2), p2: R(0, 6.28),
      };
    }

    // Keep curves gentle enough that the inside lanes never fold over.
    const maxU = ((lanes - 1) / 2 + 0.5) * LANE_SPACING * 1.2 + 30 + FORK_SPREAD * LANE_SPACING;
    const kLimit = 1 / (maxU + 80);
    let curve = null;
    if (w === 0 && n >= 4) curve = { kMin: 1 / 1600, kMax: 1 / 1000, straight: 0.5, flip: 0.6, minLen: 300, maxLen: 800 };
    else if (w === 1) curve = { kMin: 1 / 1400, kMax: lerp(1 / 800, 1 / 420, k), straight: 0.35, flip: 0.6, minLen: 300, maxLen: 800 };
    else if (w === 8) curve = { kMin: 1 / 700, kMax: 1 / 290, straight: 0.12, flip: 0.3, minLen: 350, maxLen: 1100 };
    else if (w >= 2) curve = { kMin: 1 / 1200, kMax: lerp(1 / 650, 1 / 300, Dc), straight: 0.3, flip: 0.6, minLen: 250, maxLen: 900 };
    if (curve) {
      curve.kMax = Math.min(curve.kMax, kLimit);
      curve.kMin = Math.min(curve.kMin, curve.kMax);
      curve.start = v0 * 1.2;
    }
    buildTrack(lv, rng, curve);

    for (let x = 0; x < lanes; x++) lv.laneIv.push([[TRACK_S0, length + 2000]]);

    const resv = Array.from({ length: lanes }, () => []);
    for (const rc of rects) {
      for (let x = Math.ceil(rc.l0); x <= rc.l1; x++) resv[x].push([rc.s0 - RESERVE_PAD, rc.s1 + RESERVE_PAD]);
    }
    for (let x = 0; x < lanes; x++) {
      resv[x].push([TRACK_S0, runway * 0.7]);
      resv[x].push([length - 40, length + 2000]);
    }

    function carveGap(x, g0, g1, minLen) {
      let pieces = [[g0, g1]];
      for (const rv of resv[x]) pieces = cut(pieces, rv[0], rv[1]);
      for (const p of pieces) if (p[1] - p[0] >= minLen) lv.laneIv[x] = cut(lv.laneIv[x], p[0], p[1]);
    }

    // Splits: the middle lane vanishes, and the wrong side runs out.
    const deadLead = n <= 5 ? [0.5, 0.9] : n <= 20 ? [1.0, 1.7] : [1.5, 2.6];
    for (const f of lv.forks) {
      carveGap(f.x, f.s0, f.s1, 0);
      const sDead = Math.min(f.s0 + vAt(f.s0) * R(deadLead[0], deadLead[1]), f.s1 - 40);
      for (let x = f.bad[0]; x <= f.bad[1]; x++) carveGap(x, sDead, f.s1 + 60, 0);
      f.dead = sDead;
      f.id = lv.deadEnds.length;
      lv.deadEnds.push({ s: sDead, l0: f.bad[0], l1: f.bad[1], end: f.s1 + 60, fork: f.id, side: f.side });
      lv.events.push({ type: 'fork', s: f.s0, side: f.side, deadAhead: sDead - f.s0, fork: f.id });
    }
    const inForkBad = (x, a, b) => lv.forks.some((f) => x >= f.bad[0] && x <= f.bad[1] && a < f.dead && b > f.s0 - 60);

    function addHazard(h) {
      hazardExtent(h);
      for (const rc of rects) {
        if (rc.s1 < h.e0 - 40 || rc.s0 > h.e1 + 40) continue;
        const a = Math.max(rc.s0, h.e0 - 40, 0), b = Math.min(rc.s1, h.e1 + 40);
        for (let s2 = a; s2 <= b; s2 += 4) {
          const t = tAt(s2);
          for (let l = rc.l0; l <= rc.l1 + 1e-6; l += 0.25) {
            if (hazardHits(lv, h, s2, l, t, CHECK_M, CHECK_TM)) return false;
          }
        }
      }
      lv.hazards.push(h);
      return true;
    }

    function runsOf(list) {
      const out = [];
      for (const x of list) {
        const last = out[out.length - 1];
        if (last && x === last[1] + 1) last[1] = x;
        else out.push([x, x]);
      }
      return out;
    }

    function placeElement(kind, ob) {
      const aDyn = ob.aEff + 26;          // keeps moving hazards clear of the hop window
      const room = Math.max(0, ob.b - aDyn);
      if (kind === 'gap') {
        for (const x of ob.blocked) carveGap(x, ob.a - rng() * 0.3 * (ob.a - ob.h0), ob.b + rng() * 0.5 * ob.calm, 40);
      } else if (kind === 'laser') {
        const sL = aDyn + rng() * room;
        for (const run of runsOf(ob.blocked)) addHazard({ type: 'laser', s: sL, a: run[0], b: run[1], period: 0, on: 1, phase: 0 });
      } else if (kind === 'blink') {
        const sL = aDyn + rng() * room;
        const tm = 0.1;
        const on = R(0.42, 0.58);
        const P = Math.max(lerp(1.5, 0.7, Dc) * R(0.85, 1.15), (2 * tm + 0.1) / Math.min(on, 1 - on));
        const tc = tAt(sL);
        const onX = () => R(tm / P, on - tm / P);
        const offX = () => R(on + tm / P, 1 - tm / P);
        const sync = D < 0.45 || rng() < 0.5;   // in sync: the safe lane is the one blinking out of step
        const xOn = onX(), xOff = offX();
        let placed = 0;
        for (let x = 0; x < lanes; x++) {
          // Lanes off the route's side of a split blink at random, so the dead end still looks open.
          const target = x < ob.lo || x > ob.hi ? (rng() < 0.5 ? onX() : offX())
            : ob.open.has(x) ? (sync ? xOff : offX()) : (sync ? xOn : onX());
          if (addHazard({ type: 'laser', s: sL, a: x, b: x, period: P, on, phase: frac(target - tc / P) })) placed++;
        }
        if (placed) lv.events.push({ type: 'blink', s: sL, safe: [...ob.open], sync });
      } else if (kind === 'sweeper') {
        const len = LANE_SPACING * R(0.7, lerp(1.0, 1.5, Dc));
        const cands = [];
        for (const x of ob.blocked) {
          cands.push(x);
          if (x > 0) cands.push(x - 0.5);
          if (x < lanes - 1) cands.push(x + 0.5);
        }
        const sC = aDyn + len + rng() * Math.max(0, ob.b - aDyn - len);
        const spin = (rng() < 0.5 ? -1 : 1) * lerp(1.7, 3.1, Dc) * R(0.85, 1.15);
        const lc = pick(cands);
        const base = rng() * Math.PI;
        for (let j = 0; j < 16; j++) {
          if (addHazard({ type: 'sweeper', s: sC, l: lc, len, w: spin, ph: base + (j * Math.PI) / 16 })) return;
        }
      } else if (kind === 'slider') {
        let lo, hi;
        if (rng() < lerp(0.25, 0.7, Dc)) {
          lo = Math.max(0, ob.to - 1 - (rng() < 0.4 ? 1 : 0));
          hi = Math.min(lanes - 1, ob.to + 1 + (rng() < 0.4 ? 1 : 0));
        } else {
          const run = pick(runsOf(ob.blocked));
          lo = run[0]; hi = run[1];
        }
        const sC = aDyn + 8 + rng() * room;
        const spd = lerp(2.2, 3.8, Dc) * R(0.85, 1.15);
        const base = rng() * Math.PI * 2;
        for (let j = 0; j < 12; j++) {
          const h = { type: 'slider', s: sC, l: (lo + hi) / 2, amp: (hi - lo) / 2 + 0.35, w: spd, ph: base + (j * Math.PI * 2) / 12 };
          if (addHazard(h)) return;
        }
      }
    }

    const weights = w === 0 ? (n <= 3 ? { gap: 1 } : n <= 6 ? { gap: 0.7, laser: 0.3 } : { gap: 0.45, laser: 0.25, blink: 0.15, slider: 0.15 })
      : w === 1 ? { gap: 0.35, laser: 0.2, blink: 0.2, slider: 0.15, sweeper: 0.1 }
      : w === 2 ? { gap: 0.3, laser: 0.25, blink: 0.45, slider: 0.1 }
      : w === 3 ? { gap: 0.2, laser: 0.15, blink: 0.2, sweeper: 0.45, slider: 0.35 }
      : { gap: 0.25, laser: 0.2, blink: 0.3, sweeper: 0.3, slider: 0.28 };
    const kindList = Object.keys(weights);
    const totalW = kindList.reduce((acc, kk) => acc + weights[kk], 0);
    function pickKind() {
      let x = rng() * totalW;
      for (const kk of kindList) { x -= weights[kk]; if (x <= 0) return kk; }
      return kindList[0];
    }

    for (const ob of obstacles) {
      if (!ob.blocked.length) continue;
      const count = 1 + (rng() < lerp(0.25, 0.75, Dc) ? 1 : 0) + (rng() < lerp(0.05, 0.4, Dc) ? 1 : 0);
      for (let i = 0; i < count; i++) placeElement(pickKind(), ob);
    }
    buildBuckets(lv);

    // A blocked lane that nothing actually blocks gets a gap.
    for (const ob of obstacles) {
      for (const x of ob.blocked) {
        let deadly = false;
        for (let s2 = ob.aEff; s2 <= ob.b && !deadly; s2 += 6) {
          deadly = !laneExists(lv, x, s2) || !!dangerAt(lv, s2, x, tAt(s2));
        }
        if (!deadly) carveGap(x, lerp(ob.aEff, ob.b, rng() * 0.3), ob.b + 20 + rng() * ob.calm * 0.5, 30);
      }
    }

    // Extra breaks in lanes the route doesn't need, so lanes come and go.
    // The wrong side of a split is left clean until it ends, so it looks like a real way through.
    const pDecor = D < 0.12 ? 0 : lerp(0.15, 0.5, Dc);
    if (pDecor) {
      for (let x = 0; x < lanes; x++) {
        let s2 = runway + R(0, v0);
        while (s2 < length - 60) {
          const len = R(50, 80 + 260 * Dc);
          if (rng() < pDecor && !inForkBad(x, s2, s2 + len)) carveGap(x, s2, s2 + len, 40);
          s2 += len + vAt(s2) * R(0.4, 1.6);
        }
      }
    }

    // Drop slivers of lane too short to read.
    for (let x = 0; x < lanes; x++) {
      lv.laneIv[x] = lv.laneIv[x].filter((iv) => iv[1] - iv[0] >= 36 || overlaps(resv[x], iv[0], iv[1]));
    }

    // Final check of every reserved spot; repair anything that slipped through.
    for (let pass = 0; pass < 4; pass++) {
      let bad = false;
      for (const rc of rects) {
        const a = Math.max(rc.s0, 0), b = Math.min(rc.s1, length + 40);
        for (let s2 = a; s2 <= b; s2 += 4) {
          for (let x = Math.ceil(rc.l0); x <= rc.l1; x++) {
            if (!laneExists(lv, x, s2)) { lv.laneIv[x] = restore(lv.laneIv[x], s2 - 40, s2 + 40); lv.repairs++; bad = true; }
          }
          const t = tAt(s2);
          for (let l = rc.l0; l <= rc.l1 + 1e-6; l += 0.25) {
            const h = dangerAt(lv, s2, l, t, CHECK_M, CHECK_TM);
            if (h) { h.dead = true; lv.repairs++; bad = true; }
          }
        }
      }
      if (!bad) break;
      lv.hazards = lv.hazards.filter((h) => !h.dead);
      buildBuckets(lv);
    }

    /* --- camera script: spins, mirror flips, zoom pulses, compass locks --- */
    const sections = lv.route.slice(2).map((e) => e.h0);
    function atSections(count) {
      const pool = sections.slice(), out = [];
      while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      return out.sort((p, q) => p - q);
    }
    if (w >= 5) {
      const nSpin = w === 5 ? 3 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 3) + (w === 9 ? 1 : 0);
      const angles = w >= 8
        ? [Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI * 0.75, -Math.PI * 0.75]
        : [Math.PI / 2, -Math.PI / 2, Math.PI];
      for (const s0 of atSections(nSpin)) lv.cam.spins.push({ s: s0 - vAt(s0) * 0.25, len: vAt(s0) * 0.7, a: pick(angles) });
      for (const s0 of atSections(Math.floor(rng() * 3))) {
        lv.cam.zooms.push({ s: s0, len: vAt(s0) * R(1.2, 2.2), amt: pick([-0.3, -0.2, 0.2]) });
      }
    }
    if (w >= 6) {
      const nFlip = w === 6 ? 3 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 3);
      for (const s0 of atSections(nFlip)) lv.cam.flips.push({ s: s0 - vAt(s0) * 0.2, len: vAt(s0) * 0.4 });
    }
    if (w === 8 || (w === 9 && rng() < 0.6)) {
      const s0 = w === 8 ? runway + v0 * 0.5 : R(runway, length * 0.5);
      const s1 = w === 8 ? length - v0 * 0.5 : Math.min(length - v0, s0 + v0 * R(6, 14));
      if (s1 > s0 + v0) {
        const h = headingAt(lv, s0 + 30);
        const k2 = Math.round((headingAt(lv, s1 + 30) - h) / (Math.PI * 2));
        lv.cam.locks.push({ s0, s1, blend: vAt(s0) * 0.8, h, k: k2 });
      }
    }
    // Dives: the camera drops right down to the track for a few seconds, so you see far less ahead.
    if (n >= 41) {
      for (const s0 of atSections(1 + Math.floor(rng() * 2))) {
        lv.cam.dives.push({ s: s0 - vAt(s0) * 0.3, len: vAt(s0) * R(3, 5), amt: 0.97 - lv.view.tilt });
      }
    }
    for (const key of ['spins', 'flips', 'zooms', 'dives']) lv.cam[key].sort((p, q) => p.s - q.s);

    // Things worth warning the player about, for the commentary.
    for (const e of lv.cam.spins) lv.events.push({ type: 'spin', s: e.s, a: e.a });
    for (const e of lv.cam.flips) lv.events.push({ type: 'flip', s: e.s });
    for (const e of lv.cam.locks) lv.events.push({ type: 'lock', s: e.s0 });
    for (const e of lv.speedProfile.surges) lv.events.push({ type: 'surge', s: e.s });
    for (const e of lv.cam.dives) lv.events.push({ type: 'dive', s: e.s });
    for (const e of lv.events) {
      e.t = tAt(e.s);
      if (e.type === 'fork' || e.type === 'blink') e.reversed = controlsReversedAt(lv, e.s);
    }
    lv.events.sort((a, b) => a.s - b.s);
    lv.hops = lv.route.reduce((acc, e) => acc + Math.abs(e.to - e.from), 0);
    lv.seconds = tAt(length);

    return lv;
  }

  /* ---------- running a level ---------- */

  /* A dot at the start line. Time is counted in whole ticks so a run can be replayed
     exactly: tick 0 is when the dot starts moving, the countdown is negative ticks.
     margin widens (or, negative, shrinks) every hazard; the replay check uses it. */
  function newRunner(lv, intro, margin) {
    const tick = -Math.round(intro * TICK_RATE);
    return {
      tick, s: 0, t: tick / TICK_RATE, lane: lv.startLane, from: lv.startLane, l: lv.startLane,
      hop: -1, queued: 0, dead: null, why: null, fork: -1, won: false, botI: 0, botTarget: lv.startLane,
      margin: margin || 0, acc: 0,
    };
  }

  /* Starts a hop of dir (-1 left, +1 right). Presses during a hop stack up
     (up to three), so a quick triple tap crosses three lanes. */
  function hop(lv, p, dir) {
    if (p.dead || p.won) return false;
    if (p.hop >= 0) { p.queued = clamp(p.queued + dir, -3, 3); return false; }
    p.from = p.lane;
    p.lane += dir;
    p.hop = 0;
    return true;
  }

  /* Why a fall happened: off the edge, into a lane gap, or down the wrong side of a split. */
  function fallReason(lv, p) {
    p.why = 'gap';
    if (p.lane < 0 || p.lane >= lv.lanes) { p.why = 'edge'; return; }
    for (const de of lv.deadEnds) {
      if (p.lane >= de.l0 && p.lane <= de.l1 && p.s >= de.s - 4 && p.s <= de.end) { p.why = 'deadend'; p.fork = de.fork; return; }
    }
  }

  /* Moves the dot on by exactly one tick. */
  function stepRunner(lv, p) {
    if (p.dead || p.won) return;
    p.tick++;
    p.t = p.tick / TICK_RATE;
    p.s = sAt(lv, p.t);
    if (p.hop >= 0) {
      p.hop += 1 / (HOP_TIME * TICK_RATE);
      if (p.hop >= 1) { p.hop = -1; p.l = p.lane; }
      else p.l = p.from + (p.lane - p.from) * smooth(p.hop);
    }
    if (p.hop < 0) {
      if (!laneExists(lv, p.lane, p.s)) { p.dead = 'fall'; fallReason(lv, p); return; }
      if (p.queued) { const q = Math.sign(p.queued); p.queued -= q; hop(lv, p, q); }
    }
    const h = dangerAt(lv, p.s, p.l, p.t, p.margin);
    if (h) { p.dead = 'hit'; p.why = h.type === 'laser' ? (h.period ? 'blink' : 'laser') : h.type; return; }
    if (p.s >= lv.length) p.won = true;
  }

  /* Hop distances for a bot: f(i) in [0, 1] says how late in hop window i it moves. */
  function botTriggers(lv, f) {
    return lv.route.map((e, i) => {
      const steps = Math.abs(e.to - e.from);
      const span = e.h1 - e.h0 - speedAt(lv, e.h1) * HOP_TIME * Math.max(0, steps - 1);
      return e.h0 + clamp(f(i), 0, 1) * span;
    });
  }

  function botStep(lv, p, triggers) {
    while (p.botI < triggers.length && p.s >= triggers[p.botI]) { p.botTarget = lv.route[p.botI].to; p.botI++; }
    if (p.hop < 0 && p.lane !== p.botTarget) hop(lv, p, Math.sign(p.botTarget - p.lane));
  }

  /* Advances a runner by dt of real time, in whole ticks (leftover time carries over). */
  function advance(lv, p, dt, triggers) {
    p.acc += dt;
    while (p.acc >= 1 / TICK_RATE - 1e-9 && !p.dead && !p.won) {
      if (triggers) botStep(lv, p, triggers);
      stepRunner(lv, p);
      p.acc -= 1 / TICK_RATE;
    }
  }

  const api = {
    LEVEL_COUNT, LANE_SPACING, PLAYER_R, HOP_TIME, TICK_RATE, VERSION, LASER_HALF, SWEEPER_HALF, SLIDER_R, WORLDS,
    difficulty, hopsFor, viewFor, heightAt, levelInfo, generateLevel, trackPoint, headingAt, place, laneU, laneSpacing, laneExists,
    speedAt, timeAt, sAt, laserOn, laserWarning, sweeperEnds, sliderLane, dangerAt, firstHazardFrom,
    camAt, controlsReversedAt, newRunner, hop, stepRunner, advance, botTriggers, botStep,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WHG = api;
})(typeof window !== 'undefined' ? window : globalThis);
