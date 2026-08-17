import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Sidorna läser JSON ur data/ vid build. Vercel bygger om vid varje push
  // från importern, så statisk rendering är exakt rätt granularitet:
  // datan kan per definition inte ändras mellan två deployer.
  outputFileTracingIncludes: {
    '/**': ['./data/**/*.json'],
  },
  // Vyerna döptes om till eSetts egna slugs (2026-08-17). Gamla adresser kan
  // ligga i bokmärken — låt dem peka rätt permanent.
  async redirects() {
    return [
      { source: '/natomraden', destination: '/mga', permanent: true },
      { source: '/natagare', destination: '/dso', permanent: true },
      { source: '/balansansvar', destination: '/rbr', permanent: true },
    ];
  },
};

export default nextConfig;
