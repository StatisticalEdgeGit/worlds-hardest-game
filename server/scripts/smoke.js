'use strict';

/* End-to-end check against a running server:
     node server/scripts/smoke.js [http://localhost:8080]
   Registers a throwaway player, plays survival levels 1-2 with the bot, fakes a
   clear on level 3, abandons an attempt, and reads the leaderboards. */

const replay = require('../src/replay');
const { botRun } = require('../test/bot');

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '') + '/api';
let token = null;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: `Bearer ${token}` } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function expect(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok   ${msg}`);
}

(async () => {
  const health = await call('GET', '/health');
  expect(health.status === 200 && health.json.version === replay.G.VERSION, `server is up on levels ${health.json.version}`);

  const name = `bot-${Math.random().toString(36).slice(2, 8)}`;
  const reg = await call('POST', '/players', { nickname: name });
  expect(reg.status === 201 && reg.json.token, `registered ${name}`);
  token = reg.json.token;
  const dupe = await call('POST', '/players', { nickname: name.toUpperCase() });
  expect(dupe.status === 409, 'names are unique regardless of case');

  const started = await call('POST', '/runs', { mode: 'survival', version: replay.G.VERSION });
  expect(started.status === 201, 'started a survival run');
  const runId = started.json.run.id;

  for (const n of [1, 2]) {
    const a = await call('POST', `/runs/${runId}/attempts`, { level: n });
    expect(a.status === 201, `started an attempt at level ${n}`);
    const run = botRun(replay.G, replay.level(n));
    const done = await call('POST', `/attempts/${a.json.attemptId}`, { outcome: 'clear', ...run });
    expect(done.json.status === 'clear' && done.json.verified, `level ${n} clear verified by replay`);
  }

  const a3 = await call('POST', `/runs/${runId}/attempts`, { level: 3 });
  const fake = await call('POST', `/attempts/${a3.json.attemptId}`, { outcome: 'clear', inputs: [], endTick: 5000, lane0: 0 });
  expect(fake.json.status === 'death' && fake.json.verified === false && fake.json.run.lives === 2, 'a faked clear counts as a death');

  await call('POST', `/runs/${runId}/attempts`, { level: 3 });
  const next = await call('POST', `/runs/${runId}/attempts`, { level: 3 });
  expect(next.status === 201 && next.json.run.lives === 1, 'an attempt left open costs a life');

  const pending = next.json.attemptId;
  const lateCancel = await call('POST', `/attempts/${pending}`, { outcome: 'cancel', inputs: [], endTick: 300, lane0: 0 });
  expect(lateCancel.status === 400, 'cannot cancel an attempt once the dot is moving');
  const cancel = await call('POST', `/attempts/${pending}`, { outcome: 'cancel', inputs: [], endTick: -100, lane0: 0 });
  expect(cancel.json.status === 'cancelled' && cancel.json.run.lives === 1, 'cancelling during the countdown costs nothing');
  const again = await call('POST', `/runs/${runId}/attempts`, { level: 3 });
  expect(again.status === 201 && again.json.run.lives === 1, 'and the next attempt starts without losing a life');

  const wrong = await call('POST', `/runs/${runId}/attempts`, { level: 9 });
  expect(wrong.status === 409, 'cannot skip ahead to another level');

  const board = await call('GET', '/boards/survival');
  const me = board.json.rows.find((r) => r.me);
  expect(me && me.value === 'Level 3', `on the survival board at #${me && me.rank} with ${me && me.value}`);
  for (const b of ['marathon', 'marathon-live', 'distance', 'deaths', 'levels']) {
    const r = await call('GET', `/boards/${b}`);
    expect(r.status === 200 && Array.isArray(r.json.rows), `${b} board reads (${r.json.rows.length} rows)`);
  }
  const mine = await call('GET', '/players/me');
  expect(mine.status === 200 && mine.json.ranks.survival, `player summary: survival rank #${mine.json.ranks.survival}`);
  console.log('\nAll checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
