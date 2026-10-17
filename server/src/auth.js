'use strict';

/* Players have no password: the device keeps a random secret, and the server
   keeps only its SHA-256 hash. Requests send "Bearer <player id>.<secret>". */

const crypto = require('crypto');

const hash = (secret) => crypto.createHash('sha256').update(secret).digest('hex');
const newSecret = () => crypto.randomBytes(24).toString('base64url');

function parseToken(header) {
  const m = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,64})$/.exec(header || '');
  return m ? { id: m[1], secret: m[2] } : null;
}

function matches(secret, storedHash) {
  const a = Buffer.from(hash(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { hash, newSecret, parseToken, matches };
