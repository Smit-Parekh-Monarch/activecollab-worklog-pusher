// Build script: bundles server.js (ESM) into a single CJS file for pkg.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import { mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['server.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'server-bundle.cjs',
  // keep all built-in Node modules external (pkg handles them)
  external: ['fs', 'fs/promises', 'path', 'os', 'net', 'http', 'https',
    'stream', 'crypto', 'url', 'events', 'util', 'buffer', 'querystring',
    'zlib', 'assert', 'tty', 'child_process', 'worker_threads'],
  define: {
    // esbuild replaces import.meta.url — we fix __dirname in the preamble below
    'import.meta.url': '__importMetaUrl',
  },
  banner: {
    js: [
      // pkg-compatible __dirname and __filename from the snapshot path
      'const __importMetaUrl = require("url").pathToFileURL(__filename).href;',
      'const { fileURLToPath } = require("url");',
      'const { dirname } = require("path");',
      // WORKLOG_DIR: beside the .exe at runtime (not inside the snapshot)
      'if (!process.env.WORKLOG_DIR) {',
      '  const _exeDir = require("path").dirname(process.execPath);',
      '  process.env.WORKLOG_DIR = _exeDir;',
      '  process.env.STATIC_ROOT = _exeDir;',
      '}',
    ].join('\n'),
  },
});

// pkg needs the assets declared inline — add a pkg config comment
let code = readFileSync('dist/server.cjs', 'utf8');
writeFileSync('dist/server.cjs', code);
console.log('Bundle written to server-bundle.cjs');
