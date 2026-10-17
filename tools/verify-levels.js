/* Plays all 100 levels with bots and fails if any level can't be beaten.
   Each level is run by one bot that hops early in every window, one that hops
   at the last moment, and a batch that hop at random moments in between.
   Also checks every colour cue (js/cues.js) points at a lane that's there when
   you land, and that a split's cue is on its safe side.

   Usage: node tools/verify-levels.js [--quiet] */
'use strict';

const path = require('path');
const G = require(path.join(__dirname, '..', 'js', 'levels.js'));
const C = require(path.join(__dirname, '..', 'js', 'cues.js'));

const quiet = process.argv.includes('--quiet');
const RANDOM_BOTS = 24;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function play(lv, f) {
  const p = G.newRunner(lv, 0.5);
  const triggers = G.botTriggers(lv, f);
  for (let guard = 0; guard < 200000 && !p.dead && !p.won; guard++) G.advance(lv, p, 1 / 60, triggers);
  return p;
}

let failures = 0;
let totalSeconds = 0;
if (!quiet) console.log('lvl world        speed lanes  secs hops/s  hops forks hazards repairs  gen ms');
for (let n = 1; n <= G.LEVEL_COUNT; n++) {
  const t0 = process.hrtime.bigint();
  const lv = G.generateLevel(n);
  const genMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const r = rng(n * 977);
  const bots = [() => 0.35, () => 0, () => 1];
  for (let i = 0; i < RANDOM_BOTS; i++) {
    const fs = lv.route.map(() => r());
    bots.push((j) => fs[j]);
  }
  const fails = [];
  bots.forEach((f, i) => {
    const p = play(lv, f);
    if (!p.won) fails.push(`bot ${i}: ${p.dead || 'timeout'} at s=${p.s.toFixed(0)} lane=${p.l.toFixed(2)}`);
  });
  for (const c of C.build(lv)) {
    const e = lv.route[c.route];
    const land = e.h1 + G.speedAt(lv, e.h1) * G.HOP_TIME * Math.abs(e.to - e.from) + 10;
    if (!G.laneExists(lv, c.lane, land)) fails.push(`cue for hop ${c.route}: lane ${c.lane} isn't there`);
    if (c.fork && !lv.forks.some((f) => e.h1 < f.s0 && c.lane >= f.good[0] && c.lane <= f.good[1])) fails.push(`cue for hop ${c.route}: not on the safe side of the split`);
  }
  const seconds = lv.seconds;
  totalSeconds += seconds;
  if (fails.length) {
    failures++;
    console.log(`LEVEL ${n} FAILED`);
    for (const line of fails.slice(0, 5)) console.log('  ' + line);
  }
  if (!quiet) {
    console.log(
      String(n).padStart(3) + ' ' + lv.name.padEnd(12) + ' ' + String(lv.speed).padStart(5) + ' ' +
      String(lv.lanes).padStart(5) + ' ' + seconds.toFixed(1).padStart(5) + ' ' + (lv.hops / seconds).toFixed(2).padStart(6) + ' ' +
      String(lv.hops).padStart(5) + ' ' + String(lv.forks.length).padStart(5) + ' ' + String(lv.hazards.length).padStart(7) + ' ' +
      String(lv.repairs).padStart(7) + ' ' + genMs.toFixed(1).padStart(7)
    );
  }
}
console.log(`\n${G.LEVEL_COUNT - failures}/${G.LEVEL_COUNT} levels beaten by every bot. Perfect run length: ${(totalSeconds / 60).toFixed(1)} min.`);
process.exit(failures ? 1 : 0);
