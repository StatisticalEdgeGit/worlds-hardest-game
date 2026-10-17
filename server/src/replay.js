'use strict';

/* The replay check. A submitted attempt is just the start lane, the tick of every
   hop and the tick it ended on. The server runs those inputs through the game's
   own simulation (js/levels.js, the same file the game uses) and decides what
   really happened. The client's claim only matters in one direction: a clear
   counts only if the replay reaches the finish too. */

const path = require('path');

const GAME_DIR = process.env.GAME_DIR || path.resolve(__dirname, '..', '..');
const G = require(path.join(GAME_DIR, 'js', 'levels.js'));

const START_TICK = -Math.round(0.3 * G.TICK_RATE);   // hops are allowed from 0.3 s before the dot moves
const MAX_INPUTS = 4000;
// A clear that only just fails is re-run with every hazard half a unit smaller,
// so tiny floating-point differences between a phone's browser and the server
// can't turn a genuine clear into a death.
const LENIENT_MARGIN = -0.5;
const UNITS_PER_METRE = 20;

const cache = new Map();
function level(n) {
  let lv = cache.get(n);
  if (!lv) {
    lv = G.generateLevel(n);
    cache.set(n, lv);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
  }
  return lv;
}

class InputError extends Error {}

/* Checks the shape of a submitted attempt and returns its parts. */
function parse(lv, body) {
  const endTick = body && body.endTick;
  const maxTick = Math.ceil(G.timeAt(lv, lv.length) * G.TICK_RATE) + G.TICK_RATE * 2;
  if (!Number.isInteger(endTick) || endTick < START_TICK || endTick > maxTick) throw new InputError('endTick is out of range');
  const lane0 = body.lane0 === undefined ? lv.startLane : body.lane0;
  if (!Number.isInteger(lane0) || lane0 < 0 || lane0 >= lv.lanes) throw new InputError('lane0 is not a lane on this level');
  const inputs = body.inputs;
  if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS) throw new InputError('inputs must be a list of [tick, direction]');
  let prev = START_TICK;
  for (const it of inputs) {
    if (!Array.isArray(it) || it.length !== 2 || !Number.isInteger(it[0]) || (it[1] !== 1 && it[1] !== -1)) {
      throw new InputError('each input must be [tick, 1 or -1]');
    }
    if (it[0] < prev || it[0] > endTick) throw new InputError('input ticks must be in order and before endTick');
    prev = it[0];
  }
  return { inputs, endTick, lane0 };
}

function simulate(lv, inputs, lane0, untilTick, margin) {
  const p = G.newRunner(lv, -START_TICK / G.TICK_RATE, margin);
  p.lane = p.from = p.l = lane0;
  let i = 0;
  while (!p.dead && !p.won && p.tick < untilTick) {
    while (i < inputs.length && inputs[i][0] === p.tick) { G.hop(lv, p, inputs[i][1]); i++; }
    G.stepRunner(lv, p);
  }
  return p;
}

/* Re-runs an attempt at level n. claimed: 'clear', 'death' or 'quit'. */
function check(n, body, claimed) {
  const lv = level(n);
  const { inputs, endTick, lane0 } = parse(lv, body);
  let p = simulate(lv, inputs, lane0, endTick + 2, 0);
  let lenient = false;
  if (claimed === 'clear' && !p.won) {
    const again = simulate(lv, inputs, lane0, endTick + 2, LENIENT_MARGIN);
    if (again.won) { p = again; lenient = true; }
  }
  return {
    won: p.won,
    why: p.dead ? p.why : null,
    tick: p.tick,
    lenient,
    metres: (p.won ? lv.length : Math.max(0, Math.min(p.s, lv.length))) / UNITS_PER_METRE,
    inputs, endTick, lane0,
  };
}

module.exports = { G, check, level, InputError, START_TICK, UNITS_PER_METRE };
