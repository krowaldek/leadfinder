import { createGzip } from 'node:zlib';
import { mkdirSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

const apiRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(apiRoot, '..', '..');

dotenv.config({ path: resolve(apiRoot, '.env') });
dotenv.config({ path: resolve(repoRoot, '.env'), override: false });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 10);
const defaultOutput = resolve(repoRoot, 'backups', 'db', `leadfinder-data-${stamp}.sql.gz`);
const outputPath = process.argv[2] ? resolve(process.argv[2]) : defaultOutput;

const pgDumpBinary =
  process.env.PG_DUMP_BIN ??
  [
    '/opt/homebrew/opt/postgresql@16/bin/pg_dump',
    '/opt/homebrew/opt/libpq/bin/pg_dump',
    'pg_dump',
  ].find((candidate) => candidate === 'pg_dump' || existsSync(candidate));

if (!pgDumpBinary) {
  console.error('Could not find a pg_dump binary');
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });

const dump = spawn(pgDumpBinary, ['--data-only', '--inserts', '--dbname', databaseUrl], {
  stdio: ['ignore', 'pipe', 'inherit'],
});

const exitCodePromise = new Promise((resolveExitCode) => {
  dump.on('close', resolveExitCode);
});

dump.on('error', (error) => {
  console.error('Failed to start pg_dump:', error.message);
  process.exit(1);
});

const output = createWriteStream(outputPath);

try {
  await pipeline(dump.stdout, createGzip({ level: 9 }), output);
} catch (error) {
  console.error('Dump pipeline failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const exitCode = await exitCodePromise;

if (exitCode !== 0) {
  console.error(`pg_dump exited with code ${exitCode}`);
  process.exit(exitCode ?? 1);
}

console.log(outputPath);
