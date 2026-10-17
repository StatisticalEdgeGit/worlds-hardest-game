/* Race client: one WebSocket to the game server's /ws. game.js listens with
   WHGRace.on(type, fn) for: room, start, positions, event, finished, error, gone, closed. */
(function (root) {
  'use strict';

  let ws = null;
  let opening = null;
  const handlers = {};

  function on(type, fn) {
    (handlers[type] = handlers[type] || []).push(fn);
  }
  function emit(type, msg) {
    for (const fn of handlers[type] || []) fn(msg);
  }

  function connect() {
    if (ws && ws.readyState === 1) return Promise.resolve();
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let sock;
      try {
        sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      } catch (e) {
        opening = null;
        reject(new Error('Couldn’t connect to the race server.'));
        return;
      }
      const timer = setTimeout(() => sock.close(), 6000);
      sock.onopen = () => {
        clearTimeout(timer);
        ws = sock;
        opening = null;
        resolve();
      };
      sock.onclose = (e) => {
        clearTimeout(timer);
        const wasOpen = ws === sock;
        if (wasOpen) ws = null;
        if (opening) {
          opening = null;
          reject(new Error('Couldn’t connect to the race server.'));
        }
        if (wasOpen) emit('closed', { code: e.code, message: e.reason || '' });
      };
      sock.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg && typeof msg.type === 'string') emit(msg.type, msg);
      };
    });
    return opening;
  }

  const send = (msg) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  };

  root.WHGRace = {
    on,
    host: (token, settings) => connect().then(() => send({ type: 'host', token, settings })),
    join: (token, code) => connect().then(() => send({ type: 'join', token, code })),
    rejoin: (token, code) => connect().then(() => send({ type: 'rejoin', token, code })),
    settings: (settings) => send({ type: 'settings', settings }),
    start: () => send({ type: 'start' }),
    pos: (p) => send(Object.assign({ type: 'pos' }, p)),
    event: (kind, level) => send({ type: 'event', kind, level }),
    finish: (level) => send({ type: 'finish', level }),
    again: () => send({ type: 'again' }),
    leave: () => send({ type: 'leave' }),
    get connected() { return !!ws && ws.readyState === 1; },
  };
})(window);
