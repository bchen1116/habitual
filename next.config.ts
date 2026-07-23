import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // The dev server rebuilds constantly; a stale SW there causes more
  // confusion than it prevents.
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // firebase-admin is a large SDK with dynamic requires; recommended
  // practice is to keep it out of the webpack bundle and let Node's own
  // module resolution load it. (This alone does NOT fix the jose/jwks-rsa
  // ESM crash below — that's a Node-version-dependent CJS/ESM interop
  // gap, fixed via the "jose" override in package.json instead.)
  serverExternalPackages: ["firebase-admin"],
};

export default withSerwist(nextConfig);
