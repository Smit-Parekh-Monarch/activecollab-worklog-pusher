/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The worklog files live one level up, outside the Next app, so they survive rebuilds.
  // Override with WORKLOG_DIR if you keep them elsewhere.
  env: {
    WORKLOG_DIR: process.env.WORKLOG_DIR || '',
  },
};
export default nextConfig;
