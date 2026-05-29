import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile Three.js ecosystem packages
  transpilePackages: [
    'three',
    '@react-three/fiber',
    '@react-three/drei',
    '@react-three/postprocessing',
    'postprocessing',
  ],
  // Disable strict mode for Three.js compatibility (prevents double-rendering)
  reactStrictMode: false,
  // Allow local loopback hosts to access Next.js dev resources.
  allowedDevOrigins: [
    '127.0.0.1',
  ],
};

export default nextConfig;
