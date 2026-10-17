/* Leaderboards client. Everything here is optional: when the server can't be
   reached (the claude.ai link, no connection, or the game opened as a file)
   the game plays exactly as before, just unranked. */
(function (root) {
  'use strict';

  const PLAYER_KEY = 'whg.player.v1';
  const TIMEOUT_MS = 8000;

  function read() {
    try {
      const p = JSON.parse(localStorage.getItem(PLAYER_KEY));
      return p && p.token && p.nickname ? p : null;
    } catch (e) { return null; }
  }
  function write(p) {
    try {
      if (p) localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
      else localStorage.removeItem(PLAYER_KEY);
    } catch (e) { /* storage blocked */ }
  }

  let player = read();
  let online = false;
  let serverVersion = null;
  let publicUrl = null;   // the address friends on the same Wi-Fi should open

  async function call(method, path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const headers = { 'content-type': 'application/json' };
      if (player) headers.authorization = `Bearer ${player.token}`;
      const res = await fetch(`api/${path}`, { method, headers, signal: ctrl.signal, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json.message || `Request failed (${res.status})`);
        err.status = res.status;
        err.code = json.error;
        throw err;
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  async function check() {
    try {
      const h = await call('GET', 'health');
      online = !!h.ok;
      serverVersion = h.version || null;
      publicUrl = h.publicUrl || null;
    } catch (e) {
      online = false;
    }
    return online;
  }

  async function register(nickname) {
    const r = await call('POST', 'players', { nickname });
    player = { id: r.id, nickname: r.nickname, token: r.token };
    write(player);
    return player;
  }

  async function rename(nickname) {
    const r = await call('PATCH', 'players/me', { nickname });
    player.nickname = r.nickname;
    write(player);
    return player;
  }

  /* A ranked run. Requests go out strictly one after another; if one fails, the
     run carries on unranked and hooks.onUnranked(error) says why.
     hooks.onSync(run, result) gets the server's view after each step. */
  function rankedRun(mode, version, runId, hooks) {
    let queue = Promise.resolve();
    let attemptId = null;
    let ok = true;
    const self = { runId, mode, get ranked() { return ok; } };

    function enqueue(fn) {
      queue = queue.then(() => (ok ? fn() : null)).catch((err) => {
        if (!ok) return;
        ok = false;
        if (err.status === 401) { player = null; write(null); }
        if (hooks.onUnranked) hooks.onUnranked(err);
      });
      return queue;
    }
    const sync = (run, result) => { if (hooks.onSync) hooks.onSync(run, result); };

    self.start = () => enqueue(async () => {
      const r = await call('POST', 'runs', { mode, version });
      self.runId = r.run.id;
      sync(r.run);
    });
    self.resume = () => enqueue(async () => {
      const r = await call('GET', `runs/${self.runId}`);
      if (r.run.status !== 'active') {
        const err = new Error('That run has already ended on the server.');
        err.code = 'run-over';
        throw err;
      }
      sync(r.run);
    });
    self.attempt = (level) => enqueue(async () => {
      const r = await call('POST', `runs/${self.runId}/attempts`, { level });
      attemptId = r.attemptId;
      sync(r.run, { started: true });
    });
    self.finish = (payload) => enqueue(async () => {
      if (!attemptId) return;
      const id = attemptId;
      attemptId = null;
      const r = await call('POST', `attempts/${id}`, payload);
      sync(r.run, r);
      if (payload.outcome === 'clear' && !r.verified) {
        const err = new Error('The server couldn’t verify that clear.');
        err.code = 'unverified';
        throw err;
      }
    });
    self.idle = () => queue;
    return self;
  }

  root.WHGOnline = {
    check, register, rename, rankedRun,
    me: () => call('GET', 'players/me'),
    board: (name) => call('GET', `boards/${encodeURIComponent(name)}`),
    get online() { return online; },
    get player() { return player; },
    get serverVersion() { return serverVersion; },
    get publicUrl() { return publicUrl; },
  };
})(window);
