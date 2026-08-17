import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Sidorna läser JSON ur data/ vid build. Vercel bygger om vid varje push
  // från importern, så statisk rendering är exakt rätt granularitet:
  // datan kan per definition inte ändras mellan två deployer.
  outputFileTracingIncludes: {
    '/**': ['./data/**/*.json'],
  },
};

export default nextConfig;
