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
  // firebase-admin depends on jwks-rsa -> jose (ESM-only). Webpack's
  // server bundling of that chain mangles jwks-rsa's require('jose') into
  // a call Node then rejects ("require() of ES Module ... not supported").
  // Excluding firebase-admin from bundling lets Node's own module loader
  // resolve it directly, which handles the CJS/ESM boundary correctly.
  serverExternalPackages: ["firebase-admin"],
};

export default withSerwist(nextConfig);
