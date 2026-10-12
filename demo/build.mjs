import * as esbuild from 'esbuild';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
await esbuild.build({
  entryPoints: [path.join(here, 'entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: process.argv[2] || path.join(here, 'dist/demo-api.js'),
  minify: !process.env.NOMIN,
  alias: {
    'better-sqlite3': path.join(here, 'shims/better-sqlite3.js'),
    jsonwebtoken: path.join(here, 'shims/jsonwebtoken.js'),
    express: path.join(here, 'shims/express.js'),
    crypto: path.join(here, 'shims/empty.js'),
    fs: path.join(here, 'shims/empty.js'),
    path: path.join(here, 'shims/empty.js'),
  },
  define: { 'import.meta.url': '"file:///demo"' },
  logLevel: 'info',
});
