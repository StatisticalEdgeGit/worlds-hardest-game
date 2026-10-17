'use strict';

const path = require('path');
const { createPool, migrate } = require('./db');
const { createApp } = require('./app');
const { createRaces } = require('./race');
const { G } = require('./replay');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }
  const pool = createPool(url);
  for (let i = 0; ; i++) {
    try {
      await pool.query('select 1');
      break;
    } catch (err) {
      if (i >= 30) throw err;
      console.log('Waiting for the database...');
      await sleep(1000);
    }
  }
  await migrate(pool);

  const gameDir = process.env.GAME_DIR || path.resolve(__dirname, '..', '..');
  const app = createApp({ pool, gameDir, version: G.VERSION });
  const port = Number(process.env.PORT) || 8080;
  // 0.0.0.0 so phones on the same Wi-Fi can open the game, not only this PC.
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(port, host, () => console.log(`World's Hardest Game on http://localhost:${port} (levels ${G.VERSION})`));
  const races = createRaces({ server, pool, levelCount: G.LEVEL_COUNT });

  const stop = () => { races.close(); server.close(() => pool.end().then(() => process.exit(0))); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
