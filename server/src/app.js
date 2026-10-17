'use strict';

/* HTTP API, plus the game's own files so one address serves both.

   Players:   POST /api/players {nickname} -> {id, nickname, token}
              GET/PATCH /api/players/me
   Runs:      POST /api/runs {mode, version}           start a ranked run
              GET  /api/runs/:id
              POST /api/runs/:id/attempts {level}      before each try at a level
              POST /api/attempts/:id {outcome, inputs, endTick, lane0}
   Boards:    GET  /api/boards/:name  (survival, marathon, marathon-live, distance, deaths, levels)

   An attempt left open (the app closed or the player quit mid-level) counts as
   a lost life when the next attempt starts. */

const express = require('express');
const auth = require('./auth');
const replay = require('./replay');
const { tx } = require('./db');

const NAME_RE = /^[\p{L}\p{N} ._-]{2,16}$/u;
const BOARD_SIZE = 50;
// Files the game needs; nothing else from the folder is served.
const GAME_FILE = /^\/(index\.html|style\.css|sw\.js|manifest\.webmanifest|icon[\w.-]*\.(svg|png)|js\/[\w.-]+\.js)$/;

class HttpError extends Error {
  constructor(status, error, message, extra) {
    super(message || error);
    this.status = status;
    this.body = Object.assign({ error, message: message || error }, extra);
  }
}

function cleanName(raw) {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return NAME_RE.test(name) ? name : null;
}

const runView = (r) => ({
  id: r.id, mode: r.mode, status: r.status, level: r.level, lives: r.lives,
  livesUsed: r.lives_used, metres: Math.round(r.metres * 10) / 10,
});

/* A tiny per-IP rate limit: `max` requests per `windowMs`. */
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now(), key = req.ip;
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) hits.set(key, { start: now, n: 1 });
    else if (++h.n > max) return res.status(429).json({ error: 'slow-down', message: 'Too many requests. Try again in a minute.' });
    if (hits.size > 10000) hits.clear();
    next();
  };
}

/* Leaderboards. Each query ranks everyone, then returns the top rows plus the asking player's row. */
const BOARDS = {
  survival: {
    sql: `with best as (
            select distinct on (r.player_id) r.player_id, p.nickname, r.level, r.status, r.metres,
                   coalesce(r.ended_at, r.updated_at) as at
            from runs r join players p on p.id = r.player_id
            where r.mode = 'survival' and r.version = $1
            order by r.player_id, (r.status = 'won') desc, r.level desc, r.metres desc
          ), ranked as (
            select *, row_number() over (order by (status = 'won') desc, level desc, metres desc, at) as rank from best
          )
          select * from ranked where rank <= $2 or player_id = $3 order by rank`,
    row: (r) => ({ value: r.status === 'won' ? 'Cleared 100' : `Level ${r.level}`, detail: fmtMetres(r.metres), live: r.status === 'active' }),
  },
  marathon: {
    sql: `with best as (
            select distinct on (r.player_id) r.player_id, p.nickname, r.lives_used, r.ticks, r.ended_at as at
            from runs r join players p on p.id = r.player_id
            where r.mode = 'marathon' and r.version = $1 and r.status = 'won'
            order by r.player_id, r.lives_used, r.ticks
          ), ranked as (
            select *, row_number() over (order by lives_used, ticks, at) as rank from best
          )
          select * from ranked where rank <= $2 or player_id = $3 order by rank`,
    row: (r) => ({ value: `${r.lives_used} ${r.lives_used === 1 ? 'life' : 'lives'}`, detail: fmtTicks(r.ticks) }),
  },
  'marathon-live': {
    sql: `with best as (
            select distinct on (r.player_id) r.player_id, p.nickname, r.level, r.lives_used, r.updated_at as at
            from runs r join players p on p.id = r.player_id
            where r.mode = 'marathon' and r.version = $1 and r.status = 'active'
            order by r.player_id, r.level desc, r.lives_used
          ), ranked as (
            select *, row_number() over (order by level desc, lives_used, at) as rank from best
          )
          select * from ranked where rank <= $2 or player_id = $3 order by rank`,
    row: (r) => ({ value: `Level ${r.level}`, detail: `${r.lives_used} ${r.lives_used === 1 ? 'life' : 'lives'} used`, live: true }),
  },
  distance: {
    sql: `with ranked as (
            select id as player_id, nickname, total_metres, row_number() over (order by total_metres desc, created_at) as rank
            from players where total_metres > 0
          )
          select * from ranked where rank <= $1 or player_id = $2 order by rank`,
    row: (r) => ({ value: fmtMetres(r.total_metres) }),
    noVersion: true,
  },
  deaths: {
    sql: `with ranked as (
            select id as player_id, nickname, total_deaths, total_attempts,
                   row_number() over (order by total_deaths desc, created_at) as rank
            from players where total_deaths > 0
          )
          select * from ranked where rank <= $1 or player_id = $2 order by rank`,
    row: (r) => ({ value: `${r.total_deaths} lives`, detail: `${r.total_attempts} attempts` }),
    noVersion: true,
  },
  levels: {
    sql: `select level, attempts, deaths, clears, row_number() over (order by deaths desc, level desc) as rank
          from level_stats where version = $1 and attempts > 0 order by rank limit $2`,
    row: (r) => ({
      nickname: `Level ${r.level}`,
      value: `${r.deaths} deaths`,
      detail: `${Math.round((100 * Number(r.clears)) / Math.max(1, Number(r.attempts)))}% of tries cleared`,
    }),
    noPlayer: true,
  },
};

function fmtMetres(m) {
  m = Number(m) || 0;
  return m < 10000 ? `${Math.round(m).toLocaleString('en-GB')} m` : `${(m / 1000).toFixed(1)} km`;
}
function fmtTicks(t) {
  const sec = Math.round(Number(t) / replay.G.TICK_RATE);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function createApp({ pool, gameDir, version }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  const api = express.Router();
  api.use(express.json({ limit: '96kb' }));
  api.use(rateLimit(240, 60 * 1000));
  const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  async function findPlayer(req) {
    const t = auth.parseToken(req.get('authorization'));
    if (!t) return null;
    const { rows } = await pool.query('select * from players where id = $1', [t.id]);
    return rows.length && auth.matches(t.secret, rows[0].secret_hash) ? rows[0] : null;
  }
  const requirePlayer = handle(async (req, res, next) => {
    req.player = await findPlayer(req);
    if (!req.player) throw new HttpError(401, 'auth', 'Unknown player. Pick a nickname again.');
    next();
  });
  const optionalPlayer = handle(async (req, res, next) => { req.player = await findPlayer(req); next(); });

  async function lockRun(c, runId, playerId) {
    const { rows } = await c.query('select * from runs where id = $1 and player_id = $2 for update', [runId, playerId]);
    if (!rows.length) throw new HttpError(404, 'not-found', 'No such run.');
    return rows[0];
  }

  /* Applies the result of one attempt to its run, the player's totals and the level stats. */
  async function applyResult(c, run, playerId, lvl, status, metres, ticks) {
    const clear = status === 'clear';
    run.metres += metres;
    run.ticks = Number(run.ticks) + Math.max(0, ticks);
    if (clear) {
      if (run.level >= replay.G.LEVEL_COUNT) run.status = 'won';
      else run.level += 1;
    } else if (run.mode === 'survival') {
      run.lives -= 1;
      if (run.lives <= 0) run.status = 'over';
    } else {
      run.lives_used += 1;
    }
    await c.query(
      `update runs set level = $2, lives = $3, lives_used = $4, metres = $5, ticks = $6, status = $7, updated_at = now(),
         ended_at = case when $7 = 'active' then null else now() end where id = $1`,
      [run.id, run.level, run.lives, run.lives_used, run.metres, run.ticks, run.status],
    );
    await c.query(
      `update players set total_metres = total_metres + $2, total_deaths = total_deaths + $3,
         total_clears = total_clears + $4, total_attempts = total_attempts + 1 where id = $1`,
      [playerId, metres, clear ? 0 : 1, clear ? 1 : 0],
    );
    await c.query(
      `insert into level_stats (version, level, attempts, deaths, clears) values ($1, $2, 1, $3, $4)
       on conflict (version, level) do update set attempts = level_stats.attempts + 1,
         deaths = level_stats.deaths + excluded.deaths, clears = level_stats.clears + excluded.clears`,
      [run.version, lvl, clear ? 0 : 1, clear ? 1 : 0],
    );
  }

  /* Any attempt still open on this run was left mid-level: it costs a life. */
  async function closeOpenAttempts(c, run, playerId) {
    const { rows } = await c.query(
      `update attempts set status = 'abandoned', finished_at = now() where run_id = $1 and status = 'open' returning level`,
      [run.id],
    );
    for (const a of rows) if (run.status === 'active') await applyResult(c, run, playerId, a.level, 'abandoned', 0, 0);
  }

  async function boardRows(name, playerId, limit) {
    const b = BOARDS[name];
    const who = playerId || '00000000-0000-0000-0000-000000000000';
    const params = b.noPlayer ? [version, limit] : b.noVersion ? [limit, who] : [version, limit, who];
    const { rows } = await pool.query(b.sql, params);
    return rows.map((r) => Object.assign({ rank: Number(r.rank), nickname: r.nickname, me: !!playerId && r.player_id === playerId }, b.row(r)));
  }

  api.get('/health', handle(async (req, res) => {
    await pool.query('select 1');
    // PUBLIC_URL: the address friends should open (e.g. http://192.168.1.20:8080), shown in race lobbies.
    res.json({ ok: true, version, publicUrl: process.env.PUBLIC_URL || null });
  }));

  api.post('/players', rateLimit(20, 60 * 60 * 1000), handle(async (req, res) => {
    const nickname = cleanName(req.body && req.body.nickname);
    if (!nickname) throw new HttpError(400, 'name', 'Names are 2 to 16 letters, numbers, spaces, dots, dashes or underscores.');
    const secret = auth.newSecret();
    try {
      const { rows } = await pool.query(
        'insert into players (nickname, secret_hash) values ($1, $2) returning id, nickname',
        [nickname, auth.hash(secret)],
      );
      res.status(201).json({ id: rows[0].id, nickname: rows[0].nickname, token: `${rows[0].id}.${secret}` });
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'taken', 'Someone already has that name.');
      throw err;
    }
  }));

  api.get('/players/me', requirePlayer, handle(async (req, res) => {
    const p = req.player;
    const ranks = {};
    for (const name of ['survival', 'marathon', 'distance', 'deaths']) {
      const mine = (await boardRows(name, p.id, 0)).find((r) => r.me);
      ranks[name] = mine ? mine.rank : null;
    }
    res.json({
      id: p.id, nickname: p.nickname, ranks,
      totals: { metres: p.total_metres, deaths: p.total_deaths, clears: p.total_clears, attempts: p.total_attempts },
    });
  }));

  api.patch('/players/me', requirePlayer, handle(async (req, res) => {
    const nickname = cleanName(req.body && req.body.nickname);
    if (!nickname) throw new HttpError(400, 'name', 'Names are 2 to 16 letters, numbers, spaces, dots, dashes or underscores.');
    try {
      await pool.query('update players set nickname = $2 where id = $1', [req.player.id, nickname]);
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'taken', 'Someone already has that name.');
      throw err;
    }
    res.json({ id: req.player.id, nickname });
  }));

  api.post('/runs', requirePlayer, handle(async (req, res) => {
    const mode = req.body && req.body.mode;
    if (mode !== 'survival' && mode !== 'marathon') throw new HttpError(400, 'mode', 'mode must be survival or marathon');
    if (req.body.version !== version) throw new HttpError(409, 'version', 'This copy of the game is out of date.', { version });
    const run = await tx(pool, async (c) => {
      // Starting again ends any run still going in this mode.
      const { rows: old } = await c.query(
        `update runs set status = 'abandoned', ended_at = now(), updated_at = now()
         where player_id = $1 and mode = $2 and status = 'active' returning id`,
        [req.player.id, mode],
      );
      if (old.length) await c.query(`update attempts set status = 'abandoned', finished_at = now() where run_id = any($1) and status = 'open'`, [old.map((r) => r.id)]);
      const { rows } = await c.query(
        'insert into runs (player_id, mode, version, lives) values ($1, $2, $3, $4) returning *',
        [req.player.id, mode, version, mode === 'survival' ? 3 : 0],
      );
      return rows[0];
    });
    res.status(201).json({ run: runView(run) });
  }));

  api.get('/runs/:id', requirePlayer, handle(async (req, res) => {
    const { rows } = await pool.query('select * from runs where id = $1 and player_id = $2', [req.params.id, req.player.id]);
    if (!rows.length) throw new HttpError(404, 'not-found', 'No such run.');
    res.json({ run: runView(rows[0]) });
  }));

  api.post('/runs/:id/attempts', requirePlayer, handle(async (req, res) => {
    const lvl = req.body && req.body.level;
    const out = await tx(pool, async (c) => {
      const run = await lockRun(c, req.params.id, req.player.id);
      await closeOpenAttempts(c, run, req.player.id);
      if (run.status !== 'active') throw new HttpError(409, 'run-over', 'This run has ended.', { run: runView(run) });
      if (lvl !== run.level) throw new HttpError(409, 'level', `This run is on level ${run.level}.`, { run: runView(run) });
      const { rows } = await c.query('insert into attempts (run_id, level) values ($1, $2) returning id', [run.id, lvl]);
      return { attemptId: String(rows[0].id), run: runView(run) };
    });
    res.status(201).json(out);
  }));

  api.post('/attempts/:id', requirePlayer, handle(async (req, res) => {
    const outcome = req.body && req.body.outcome;
    if (!['clear', 'death', 'quit', 'cancel'].includes(outcome)) throw new HttpError(400, 'outcome', 'outcome must be clear, death, quit or cancel');
    if (!/^\d+$/.test(req.params.id)) throw new HttpError(404, 'not-found', 'No such attempt.');
    const out = await tx(pool, async (c) => {
      const { rows } = await c.query(
        `select a.* from attempts a join runs r on r.id = a.run_id where a.id = $1 and r.player_id = $2 for update of a`,
        [req.params.id, req.player.id],
      );
      if (!rows.length) throw new HttpError(404, 'not-found', 'No such attempt.');
      const att = rows[0];
      if (att.status !== 'open') throw new HttpError(409, 'closed', 'That attempt is already finished.');
      const run = await lockRun(c, att.run_id, req.player.id);
      if (outcome === 'cancel') {
        // Only before the dot has moved: nothing has happened yet, so it costs nothing.
        if (!Number.isInteger(req.body.endTick) || req.body.endTick > 0) {
          throw new HttpError(400, 'bad-input', 'An attempt can only be cancelled before the dot starts moving.');
        }
        await c.query(`update attempts set status = 'cancelled', end_tick = $2, finished_at = now() where id = $1`, [att.id, req.body.endTick]);
        return { status: 'cancelled', verified: true, lenient: false, run: runView(run) };
      }
      let r;
      try {
        r = replay.check(att.level, req.body, outcome);
      } catch (err) {
        if (err instanceof replay.InputError) throw new HttpError(400, 'bad-input', err.message);
        throw err;
      }
      const status = outcome === 'clear' && r.won ? 'clear' : outcome === 'quit' ? 'quit' : 'death';
      const verified = outcome !== 'clear' || r.won;
      await c.query(
        `update attempts set status = $2, verified = $3, lenient = $4, lane0 = $5, inputs = $6, end_tick = $7,
           metres = $8, cause = $9, finished_at = now() where id = $1`,
        [att.id, status, verified, r.lenient, r.lane0, JSON.stringify(r.inputs), r.endTick, r.metres, r.why],
      );
      await applyResult(c, run, req.player.id, att.level, status, r.metres, r.tick);
      return { status, verified, lenient: r.lenient, run: runView(run) };
    });
    res.json(out);
  }));

  api.get('/boards/:name', optionalPlayer, handle(async (req, res) => {
    if (!BOARDS[req.params.name]) throw new HttpError(404, 'not-found', 'No such leaderboard.');
    const rows = await boardRows(req.params.name, req.player && req.player.id, BOARD_SIZE);
    res.json({ board: req.params.name, version, rows });
  }));

  api.use((req, res) => res.status(404).json({ error: 'not-found', message: 'No such endpoint.' }));
  api.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json(err.body);
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'bad-input', message: err.message });
    console.error(err);
    res.status(500).json({ error: 'server', message: 'Something went wrong on the server.' });
  });
  app.use('/api', api);

  // The game itself.
  const files = express.static(gameDir, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') });
  app.get('/', (req, res) => res.set('Cache-Control', 'no-cache').sendFile('index.html', { root: gameDir }));
  app.use((req, res, next) => (GAME_FILE.test(req.path) ? files(req, res, next) : next()));
  app.use((req, res) => res.status(404).send('Not found'));
  return app;
}

module.exports = { createApp, BOARDS };
