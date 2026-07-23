import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE_URL}/`, priority: 1 },
    { url: `${BASE_URL}/login`, priority: 0.5 },
    { url: `${BASE_URL}/terms`, priority: 0.2 },
    { url: `${BASE_URL}/privacy`, priority: 0.2 },
  ];
}
