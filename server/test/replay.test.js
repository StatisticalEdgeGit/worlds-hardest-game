'use strict';

const test = require('node:test');
const assert = require('node:assert');
const replay = require('../src/replay');
const { botRun } = require('./bot');

const { G } = replay;

for (const n of [1, 12, 33, 57, 95]) {
  test(`a genuine clear of level ${n} replays as a clear`, () => {
    const run = botRun(G, replay.level(n));
    assert.ok(run.won, 'bot should clear the level');
    const r = replay.check(n, run, 'clear');
    assert.strictEqual(r.won, true);
    assert.strictEqual(r.lenient, false);
    assert.ok(r.metres > 100);
  });
}

test('dropping one hop turns a claimed clear into a death', () => {
  const run = botRun(G, replay.level(20));
  const inputs = run.inputs.filter((_, i) => i !== Math.floor(run.inputs.length / 2));
  const r = replay.check(20, { ...run, inputs }, 'clear');
  assert.strictEqual(r.won, false);
  assert.ok(r.why, 'the replay should say what killed the dot');
});

test('claiming a clear with no hops at all is rejected', () => {
  const run = botRun(G, replay.level(5));
  const r = replay.check(5, { ...run, inputs: [] }, 'clear');
  assert.strictEqual(r.won, false);
});

test('shifting every hop a second late fails the replay', () => {
  const run = botRun(G, replay.level(40));
  const inputs = run.inputs.map(([t, d]) => [t + G.TICK_RATE, d]);
  const r = replay.check(40, { ...run, inputs }, 'clear');
  assert.strictEqual(r.won, false);
});

test('badly formed inputs are refused', () => {
  const lv = replay.level(3);
  const good = botRun(G, lv);
  assert.throws(() => replay.check(3, { ...good, inputs: [[5, 2]] }, 'clear'), replay.InputError);
  assert.throws(() => replay.check(3, { ...good, inputs: [[50, 1], [40, 1]] }, 'clear'), replay.InputError);
  assert.throws(() => replay.check(3, { ...good, inputs: [[-500, 1]] }, 'clear'), replay.InputError);
  assert.throws(() => replay.check(3, { ...good, lane0: 99 }, 'clear'), replay.InputError);
  assert.throws(() => replay.check(3, { ...good, endTick: 10e6 }, 'clear'), replay.InputError);
});

test('a death is scored at the distance the replay reached', () => {
  const run = botRun(G, replay.level(8));
  const cut = run.inputs.slice(0, 3);
  const r = replay.check(8, { ...run, inputs: cut, endTick: run.endTick }, 'death');
  assert.strictEqual(r.won, false);
  assert.ok(r.metres > 0 && r.metres < replay.level(8).length / replay.UNITS_PER_METRE);
});
