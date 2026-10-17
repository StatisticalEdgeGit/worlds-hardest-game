'use strict';

/* Races. A host opens a room and gets a 4-letter code; up to three friends join
   with it. Everyone races the same levels from the same start; dying sends you back
   to your last checkpoint; the first to clear the final level wins.

   Talks over a WebSocket at /ws. Rooms live in memory only: nothing about a race
   is stored. Players are identified by their leaderboard nickname (the same
   device token as the API), so nobody can race under someone else's name.

   Phones drop the connection when the screen locks or another app comes to the
   front, so a dropped racer keeps their place: they come back with `rejoin` and
   carry on. A race nobody is connected to is kept for a few minutes for that.

   Client -> server: host {token, settings} | join {token, code} | rejoin {token, code}
     | settings {settings} | start | pos {level, s, l, t, alive, progress, deaths}
     | event {kind, level} | finish {level} | again | leave
   Server -> client: room {room, you} | start {settings, startsIn} | positions {players}
     | event {id, name, kind, level} | finished {winner, standings} | error {message}
     | gone {message} (a rejoin found nothing to rejoin) */

const { WebSocketServer } = require('ws');
const auth = require('./auth');

const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // no I or O, which look like 1 and 0
const COLORS = ['#4dffb8', '#ffd84d', '#6db8ff', '#ff9d4d'];
const STARTS = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91];
const LENGTHS = [3, 5, 10, 20];
const CHECKPOINTS = [1, 3, 5];
const COUNTDOWN_MS = 3500;
const TICK_MS = 100;                                 // position broadcasts, 10 a second
const IDLE_ROOM_MS = 2 * 60 * 60 * 1000;
const EMPTY_ROOM_MS = 5 * 60 * 1000;                 // how long a race waits for dropped racers

function createRaces({ server, pool, levelCount }) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  const rooms = new Map();
  let nextId = 1;

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const active = (room) => [...room.players.values()].filter((p) => !p.left);

  function newCode() {
    let code;
    do code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    while (rooms.has(code));
    return code;
  }

  function cleanSettings(s, prev) {
    const base = prev || { start: 1, length: 5, checkpoint: 5 };
    const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
    const out = {
      start: pick(s && s.start, STARTS, base.start),
      length: pick(s && s.length, LENGTHS, base.length),
      checkpoint: pick(s && s.checkpoint, CHECKPOINTS, base.checkpoint),
    };
    out.length = Math.min(out.length, levelCount - out.start + 1);
    return out;
  }

  function view(room) {
    return {
      code: room.code, state: room.state, settings: room.settings, hostId: room.hostId, winner: room.winner,
      players: [...room.players.values()].map((p) => ({
        id: p.id, name: p.name, color: p.color, host: p.id === room.hostId,
        level: p.level, progress: p.progress, deaths: p.deaths, done: p.done, left: p.left,
      })),
    };
  }

  function sync(room) {
    room.touched = Date.now();
    for (const p of active(room)) send(p.ws, { type: 'room', room: view(room), you: p.id });
  }

  function broadcast(room, msg) {
    for (const p of active(room)) send(p.ws, msg);
  }

  function standings(room) {
    return [...room.players.values()]
      .sort((a, b) => (b.done - a.done) || (b.progress - a.progress))
      .map((p, i) => ({ place: i + 1, id: p.id, name: p.name, color: p.color, level: p.level, deaths: p.deaths, done: p.done, left: p.left }));
  }

  function resetRacers(room) {
    for (const p of room.players.values()) {
      Object.assign(p, { level: room.settings.start, s: 0, l: 0, t: 0, alive: false, posAt: 0, progress: 0, deaths: 0, done: false });
    }
  }

  async function nickname(token) {
    const t = auth.parseToken(token ? `Bearer ${token}` : '');
    if (!t) return null;
    const { rows } = await pool.query('select nickname, secret_hash from players where id = $1', [t.id]);
    return rows.length && auth.matches(t.secret, rows[0].secret_hash) ? rows[0].nickname : null;
  }

  function join(room, me, name) {
    const used = new Set([...room.players.values()].filter((p) => !p.left).map((p) => p.color));
    me.room = room;
    room.players.set(me.id, {
      id: me.id, ws: me.ws, name, color: COLORS.find((c) => !used.has(c)) || COLORS[0],
      level: room.settings.start, s: 0, l: 0, t: 0, alive: false, posAt: 0, progress: 0, deaths: 0, done: false, left: false,
    });
  }

  // `dropped` is a lost connection rather than pressing Leave; it only changes what the others are told.
  function leave(me, dropped) {
    const room = me.room;
    if (!room) return;
    me.room = null;
    const p = room.players.get(me.id);
    if (!p || p.ws !== me.ws) return;   // this racer already rejoined on a new connection
    if (room.state === 'lobby') room.players.delete(me.id);
    else p.left = true;
    const left = active(room);
    if (!left.length) {
      // An empty lobby goes now; a race waits (see the sweep) in case its racers rejoin.
      if (room.state === 'lobby' && rooms.get(room.code) === room) rooms.delete(room.code);
      return;
    }
    if (room.hostId === me.id) room.hostId = left[0].id;
    broadcast(room, { type: 'event', id: p.id, name: p.name, kind: dropped && room.state === 'racing' ? 'dropped' : 'left', level: p.level });
    sync(room);
  }

  // Takes a racer back into their old place in the room on their new connection.
  function rejoin(me, room, p) {
    const old = p.ws;
    Object.assign(p, { ws: me.ws, left: false });
    me.id = p.id;
    me.room = room;
    if (old !== me.ws) old.terminate();
    if (!active(room).some((q) => q.id === room.hostId)) room.hostId = p.id;
    if (room.state === 'racing') broadcast(room, { type: 'event', id: p.id, name: p.name, kind: 'back', level: p.level });
    sync(room);
    if (room.state === 'finished') send(me.ws, { type: 'finished', winner: room.winner, standings: standings(room) });
  }

  async function handle(me, msg) {
    const room = me.room;
    const p = room && room.players.get(me.id);
    const isHost = room && room.hostId === me.id;
    if (room) room.touched = Date.now();
    switch (msg.type) {
      case 'host': {
        const name = await nickname(msg.token);
        if (!name) return send(me.ws, { type: 'error', message: 'Pick a leaderboard name first.' });
        leave(me);
        const r = { code: newCode(), hostId: me.id, settings: cleanSettings(msg.settings), state: 'lobby', players: new Map(), winner: null, touched: Date.now() };
        rooms.set(r.code, r);
        join(r, me, name);
        return sync(r);
      }
      case 'join': {
        const name = await nickname(msg.token);
        if (!name) return send(me.ws, { type: 'error', message: 'Pick a leaderboard name first.' });
        const r = rooms.get(String(msg.code || '').trim().toUpperCase());
        if (!r) return send(me.ws, { type: 'error', message: 'No race with that code. Check it with the host.' });
        if (r.state !== 'lobby') return send(me.ws, { type: 'error', message: 'That race has already started.' });
        if (active(r).length >= MAX_PLAYERS) return send(me.ws, { type: 'error', message: 'That race is full (4 players).' });
        if (active(r).some((q) => q.name.toLowerCase() === name.toLowerCase())) return send(me.ws, { type: 'error', message: 'You’re already in that race.' });
        leave(me);
        join(r, me, name);
        return sync(r);
      }
      case 'rejoin': {
        const name = await nickname(msg.token);
        if (!name) return send(me.ws, { type: 'error', message: 'Pick a leaderboard name first.' });
        const r = rooms.get(String(msg.code || '').trim().toUpperCase());
        const mine = r && [...r.players.values()].find((q) => q.name.toLowerCase() === name.toLowerCase());
        if (!r || (!mine && r.state !== 'lobby')) return send(me.ws, { type: 'gone', message: 'That race is over.' });
        if (!mine && active(r).length >= MAX_PLAYERS) return send(me.ws, { type: 'gone', message: 'That race is full now.' });
        leave(me);
        if (mine) return rejoin(me, r, mine);
        join(r, me, name);       // dropped from a lobby, which forgets you: just join again
        return sync(r);
      }
      case 'settings':
        if (!isHost || room.state !== 'lobby') return;
        room.settings = cleanSettings(msg.settings, room.settings);
        return sync(room);
      case 'start':
        if (!isHost || room.state !== 'lobby') return;
        if (active(room).length < 2) return send(me.ws, { type: 'error', message: 'You need at least one other racer.' });
        room.state = 'racing';
        room.winner = null;
        resetRacers(room);
        broadcast(room, { type: 'start', settings: room.settings, startsIn: COUNTDOWN_MS });
        return sync(room);
      case 'pos':
        if (!p || room.state !== 'racing') return;
        if (Number.isInteger(msg.level) && msg.level >= room.settings.start && msg.level < room.settings.start + room.settings.length) p.level = msg.level;
        if (Number.isFinite(msg.s)) p.s = msg.s;
        if (Number.isFinite(msg.l)) p.l = msg.l;
        if (Number.isFinite(msg.t)) p.t = msg.t;
        p.alive = msg.alive !== false;
        p.posAt = Date.now();
        if (Number.isFinite(msg.progress)) p.progress = Math.max(0, Math.min(1, msg.progress));
        // Deaths while the connection was down never reached us as events; the racer's own count catches up.
        if (Number.isInteger(msg.deaths) && msg.deaths > p.deaths) p.deaths = Math.min(msg.deaths, 1e6);
        return;
      case 'event':
        if (!p || room.state !== 'racing' || !['death', 'checkpoint'].includes(msg.kind)) return;
        if (msg.kind === 'death') p.deaths++;
        return broadcast(room, { type: 'event', id: p.id, name: p.name, kind: msg.kind, level: Number(msg.level) || p.level });
      case 'finish':
        if (!p || room.state !== 'racing' || room.winner) return;
        p.done = true;
        p.progress = 1;
        p.level = room.settings.start + room.settings.length - 1;
        room.winner = { id: p.id, name: p.name };
        room.state = 'finished';
        broadcast(room, { type: 'finished', winner: room.winner, standings: standings(room) });
        return sync(room);
      case 'again':
        if (!isHost || room.state !== 'finished') return;
        for (const [id, q] of room.players) if (q.left) room.players.delete(id);
        room.state = 'lobby';
        room.winner = null;
        resetRacers(room);
        return sync(room);
      case 'leave':
        return leave(me);
      default:
        return undefined;
    }
  }

  wss.on('connection', (ws) => {
    const me = { id: String(nextId++), ws, room: null };
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      handle(me, msg).catch((err) => {
        console.error(err);
        send(ws, { type: 'error', message: 'Something went wrong on the server.' });
      });
    });
    ws.on('close', () => leave(me, true));
  });

  // Everyone's latest position, 10 times a second, to everyone in a running race.
  // A racer who has stopped sending (screen off, app in the background) drops off
  // the track instead of leaving a frozen ghost.
  const positions = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.state !== 'racing') continue;
      const players = active(room).map((p) => ({ id: p.id, level: p.level, s: p.s, l: p.l, t: p.t, alive: p.alive && now - p.posAt < 1500, progress: p.progress }));
      broadcast(room, { type: 'positions', players });
    }
  }, TICK_MS);

  // Drop connections that stopped answering, and rooms nobody has touched for hours.
  // Players still connected to an idle room are told why, not left in a dead lobby.
  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
    const now = Date.now();
    for (const [code, room] of rooms) {
      const idle = now - room.touched;
      if (idle <= IDLE_ROOM_MS && (active(room).length || idle <= EMPTY_ROOM_MS)) continue;
      rooms.delete(code);
      for (const p of active(room)) p.ws.close(4000, 'That race timed out. Host a new one.');
    }
  }, 30 * 1000);

  return {
    rooms,
    close() { clearInterval(positions); clearInterval(sweep); wss.close(); },
  };
}

module.exports = { createRaces, STARTS, LENGTHS, CHECKPOINTS, MAX_PLAYERS };
