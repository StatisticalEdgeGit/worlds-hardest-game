'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS = path.join(__dirname, '..', 'migrations');

function createPool(connectionString) {
  return new Pool({ connectionString, max: 10 });
}

/* Applies every migrations/*.sql file not yet applied, in name order, each in its own transaction. */
async function migrate(pool) {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await pool.query('select 1 from schema_migrations where name = $1', [file]);
    if (done.rowCount) continue;
    await tx(pool, async (c) => {
      await c.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
      await c.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    console.log(`Applied migration ${file}`);
  }
}

/* Runs fn(client) inside a transaction. */
async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPool, migrate, tx };
