/* Lane colours and colour cues. Every lane keeps one colour for the whole level,
   counted from the left at the start line. Where you can't see the way in time, the
   colour of the lane to be on flashes up instead of VEX saying it in words:

   - the hop onto the safe side of a split, before the other side runs out;
   - from level 7, every hop through a section with a laser in it.

   A cue has two parts. From a little before the hop window it says where: the
   colour shows steadily, but the obstacle before it may still be ahead, so wait.
   When the window opens (it is safe to hop from then until it closes) it says
   when: the colour flashes. The next cue follows straight on, so a run of called
   hops reads as a run of colours.
   The colours stay clear of the hazards: no red (lasers, dead ends), orange
   (sweepers, sliders) or pink (your dot). Loads in Node too, for checks. */
(function (root) {
  'use strict';

  const G = root.WHG || require('./levels.js');

  const LANE_COLORS = [
    [0.22, 0.48, 1],     // blue
    [1, 0.9, 0.22],      // yellow
    [0.2, 0.95, 1],      // cyan
    [0.62, 0.34, 1],     // purple
    [0.28, 1, 0.45],     // green
    [0.94, 0.96, 1],     // white
    [0.6, 1, 0.1],       // lime
  ];
  const NAMES = ['blue', 'yellow', 'cyan', 'purple', 'green', 'white', 'lime'];

  const LEAD = 1.2;        // seconds of "get ready" before a called hop's window opens
  const FORK_LEAD = 1.6;   // a split gets a little more
  const HOLD = 0.15;       // seconds the colour stays up after the window closes
  const LASER_FROM = 7;    // first level whose laser hops are called

  const color = (lane) => LANE_COLORS[((lane % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];
  const css = (lane) => `rgb(${color(lane).map((v) => Math.round(v * 255)).join(', ')})`;

  /* [{lane, t0, tGo, t1, fork, route}] in run time: get ready from t0, hop from tGo,
     gone at t1. Sorted, never overlapping. Cached on the level. */
  function build(lv) {
    if (lv.laneCues) return lv.laneCues;
    const route = lv.route || [];
    const called = new Map();   // route index -> true when it enters a split
    for (const f of lv.forks) {
      let k = -1;
      for (let i = 0; i < route.length; i++) if (route[i].h1 < f.s0) k = i;
      if (k >= 0) called.set(k, true);
    }
    if (lv.n >= LASER_FROM) {
      route.forEach((e, i) => {
        const zone1 = i + 1 < route.length ? route[i + 1].h0 : lv.length;
        const laser = lv.hazards.some((h) => h.type === 'laser' && h.s >= e.h1 - 4 && h.s < zone1);
        if (laser && e.from !== e.to && !called.has(i)) called.set(i, false);
      });
    }
    const cues = [];
    for (const i of [...called.keys()].sort((a, b) => a - b)) {
      const e = route[i], fork = called.get(i);
      const prev = cues[cues.length - 1];
      const tGo = G.timeAt(lv, e.h0);
      if (prev && prev.t1 > tGo) prev.t1 = tGo;   // never hold the last colour into this hop's window
      const t0 =Math.min(tGo, Math.max(tGo - (fork ? FORK_LEAD : LEAD), prev ? prev.t1 : -Infinity));
      cues.push({ lane: e.to, t0, tGo, t1: G.timeAt(lv, e.h1) + HOLD, fork, route: i });
    }
    lv.laneCues = cues;
    return cues;
  }

  /* The cue showing at run time t, or null. */
  function at(lv, t) {
    for (const c of build(lv)) {
      if (c.t0 > t) break;
      if (t < c.t1) return c;
    }
    return null;
  }

  const api = { LANE_COLORS, NAMES, color, css, build, at };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WHGCues = api;
})(typeof window !== 'undefined' ? window : globalThis);
