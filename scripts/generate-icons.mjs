/**
 * Generates PWA/app icons from an inline SVG. Placeholder branding — a bold
 * "H" on the primary color — until step 7's real identity work. Rerun with:
 *   node scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const BG = "#171717";
const FG = "#fafafa";

function iconSvg(size, pad = 0) {
  const glyphSize = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${pad > 0 ? 0 : size * 0.2}" fill="${BG}"/>
    <text x="50%" y="50%" dy="${glyphSize * 0.03}"
      font-family="Arial, Helvetica, sans-serif" font-weight="bold"
      font-size="${glyphSize * 0.62}" fill="${FG}"
      text-anchor="middle" dominant-baseline="central">H</text>
  </svg>`;
}

await mkdir("public/icons", { recursive: true });

const targets = [
  { file: "public/icons/icon-192.png", size: 192, pad: 0 },
  { file: "public/icons/icon-512.png", size: 512, pad: 0 },
  // Maskable: safe zone is the inner 80%, so pad the glyph.
  { file: "public/icons/icon-maskable-512.png", size: 512, pad: 64 },
  { file: "public/icons/apple-touch-icon.png", size: 180, pad: 0 },
];

for (const { file, size, pad } of targets) {
  await sharp(Buffer.from(iconSvg(size, pad))).png().toFile(file);
  console.log(`wrote ${file}`);
}

// Default OG image (1200x630) for link previews.
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="${BG}"/>
  <text x="600" y="280" font-family="Arial, Helvetica, sans-serif" font-weight="bold"
    font-size="120" fill="${FG}" text-anchor="middle">Habitual</text>
  <text x="600" y="380" font-family="Arial, Helvetica, sans-serif"
    font-size="44" fill="#a3a3a3" text-anchor="middle">Put your money where your habits are.</text>
</svg>`;
await sharp(Buffer.from(ogSvg)).png().toFile("public/og-image.png");
console.log("wrote public/og-image.png");
