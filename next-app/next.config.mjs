import { fileURLToPath } from 'url';
import { dirname } from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the Turbopack root to this app dir (a lockfile also exists one level up,
  // which otherwise makes Next guess the wrong workspace root).
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  // The worklog files live one level up, outside the Next app, so they survive rebuilds.
  // Override with WORKLOG_DIR if you keep them elsewhere.
  env: {
    WORKLOG_DIR: process.env.WORKLOG_DIR || '',
  },
};
export default nextConfig;
