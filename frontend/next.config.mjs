/** @type {import('next').NextConfig} */
const nextConfig = {
  // StrictMode is off because of the digital twin. React 19 StrictMode
  // double-invokes mount effects; react-three-fiber responds to the simulated
  // unmount by disposing the renderer, which force-loses the WebGL context on
  // that canvas element. The remount cannot acquire a new context and the twin
  // renders blank. This is a known react-three-fiber constraint, not a bug in
  // the scene, and disabling StrictMode is the standard remedy.
  reactStrictMode: false,
  transpilePackages: ["three"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
