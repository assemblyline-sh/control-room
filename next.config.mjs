import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
  // lib-ui ships JSX source with extensionless imports.
  transpilePackages: ['@fob/lib-ui'],
  // Pin the root: a lockfile further up (~/ec2code) would otherwise be picked.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
};

export default nextConfig;
