'use strict';

/* End-to-end race check against a running server:
     node server/scripts/race-smoke.js [http://localhost:8080]
   Registers two throwaway players, hosts a race, joins it, starts it, swaps
   positions, drops and rejoins a racer, finishes, and checks every racer is told who won. */

const WebSocket = require('ws');

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');

function expect(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok   ${msg}`);
}

async function register() {
  const res = await fetch(`${BASE}/api/players`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname: `racer-${Math.random().toString(36).slice(2, 7)}` }),
  });
  return res.json();
}

/* A socket that queues every message so the test can wait for a particular type. */
function client() {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`);
  const inbox = [];
  const waiting = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const i = waiting.findIndex((w) => w.type === msg.type && w.test(msg));
    if (i >= 0) waiting.splice(i, 1)[0].resolve(msg); else inbox.push(msg);
  });
  return {
    ws,
    open: () => new Promise((r) => ws.once('open', r)),
    send: (msg) => ws.send(JSON.stringify(msg)),
    next(type, test = () => true, ms = 4000) {
      const i = inbox.findIndex((m) => m.type === type && test(m));
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiting.push({ type, test, resolve });
        setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), ms);
      });
    },
  };
}

(async () => {
  const [a, b] = await Promise.all([register(), register()]);
  expect(a.token && b.token, `registered ${a.nickname} and ${b.nickname}`);

  const host = client();
  let guest = client();
  await Promise.all([host.open(), guest.open()]);

  host.send({ type: 'host', token: a.token, settings: { start: 11, length: 3, checkpoint: 3 } });
  const lobby = await host.next('room');
  const code = lobby.room.code;
  expect(/^[A-Z]{4}$/.test(code) && lobby.room.settings.start === 11, `hosted room ${code} racing levels 11-13`);

  guest.send({ type: 'join', token: b.token, code: 'ZZZZ' });
  expect(/No race/.test((await guest.next('error')).message), 'a wrong code is refused');
  guest.send({ type: 'join', token: 'nonsense', code });
  expect(/name/.test((await guest.next('error')).message), 'joining without a name is refused');

  guest.send({ type: 'join', token: b.token, code });
  const joined = await host.next('room', (m) => m.room.players.length === 2);
  expect(joined.room.players.map((p) => p.color).length === 2 && joined.room.players[0].color !== joined.room.players[1].color, 'guest joined with a different colour');

  guest.send({ type: 'start' });
  host.send({ type: 'settings', settings: { start: 21, length: 5, checkpoint: 1 } });
  const changed = await guest.next('room', (m) => m.room.settings.start === 21);
  expect(changed.room.settings.length === 5, 'only the host can change settings, and everyone sees them');

  host.send({ type: 'start' });
  const [sa, sb] = await Promise.all([host.next('start'), guest.next('start')]);
  expect(sa.startsIn > 0 && sb.settings.start === 21, 'both racers get the start signal');

  host.send({ type: 'pos', level: 22, s: 900, l: 2, t: 4, alive: true, progress: 0.3 });
  const pos = await guest.next('positions', (m) => m.players.some((p) => p.level === 22));
  expect(pos.players.find((p) => p.level === 22).progress === 0.3, 'the guest sees the host’s position');

  guest.send({ type: 'event', kind: 'death', level: 21 });
  const ev = await host.next('event', (m) => m.kind === 'death');
  expect(ev.name === b.nickname, 'the host hears about the guest’s death');

  // A dropped connection (a phone locking, say) keeps the racer's place in the race.
  const guestId = joined.room.players.find((p) => p.name === b.nickname).id;
  guest.ws.terminate();
  const dropped = await host.next('event', (m) => m.kind === 'dropped');
  expect(dropped.name === b.nickname, 'the host hears the guest’s connection dropped');
  const stray = client();
  await stray.open();
  stray.send({ type: 'rejoin', token: b.token, code: 'ZZZZ' });
  expect(/over/.test((await stray.next('gone')).message), 'rejoining a race that doesn’t exist is refused');
  stray.ws.close();
  guest = client();
  await guest.open();
  guest.send({ type: 'rejoin', token: b.token, code });
  const [backEv, rejoined] = await Promise.all([host.next('event', (m) => m.kind === 'back'), guest.next('room')]);
  const mine = rejoined.room.players.find((p) => p.id === rejoined.you);
  expect(backEv.name === b.nickname && rejoined.you === guestId && mine.deaths === 1 && !mine.left, 'the guest rejoins in the same place with their death still counted');
  guest.send({ type: 'pos', level: 23, s: 100, l: 1, t: 1, alive: true, progress: 0.5, deaths: 3 });

  guest.send({ type: 'finish', level: 25 });
  const [fa, fb] = await Promise.all([host.next('finished'), guest.next('finished')]);
  expect(fa.winner.name === b.nickname && fb.standings[0].name === b.nickname && fb.standings[1].name === a.nickname, `${b.nickname} wins and standings agree`);
  expect(fa.standings[0].deaths === 3, 'deaths missed while offline catch up from the racer’s own count');

  host.send({ type: 'again' });
  const back = await guest.next('room', (m) => m.room.state === 'lobby');
  expect(back.room.players.every((p) => p.progress === 0), 'race again returns everyone to the lobby');

  host.ws.close();
  const after = await guest.next('room', (m) => m.room.players.length === 1);
  expect(after.room.hostId === after.room.players[0].id, 'when the host leaves, the guest becomes host');
  guest.ws.close();
  console.log('\nAll race checks passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
