// Regenerates public/og.png (1200x630 social card). Run: node scripts/make-og-image.mjs
import sharp from "sharp";

const width = 1200;
const height = 630;
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <radialGradient id="g1" cx="0.3" cy="0.2" r="0.7"><stop offset="0" stop-color="#25b5c8" stop-opacity="0.45"/><stop offset="1" stop-color="#25b5c8" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="0.85" cy="0.9" r="0.6"><stop offset="0" stop-color="#8b7cf6" stop-opacity="0.35"/><stop offset="1" stop-color="#8b7cf6" stop-opacity="0"/></radialGradient>
    <linearGradient id="t" x1="0" x2="1"><stop offset="0" stop-color="#7fd9e6"/><stop offset="0.5" stop-color="#25b5c8"/><stop offset="1" stop-color="#8b7cf6"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="#0e1211"/>
  <rect width="100%" height="100%" fill="url(#g1)"/>
  <rect width="100%" height="100%" fill="url(#g2)"/>
  <text x="80" y="330" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="74" fill="#f4f7f6" letter-spacing="-2">Your coding agents,</text>
  <text x="80" y="420" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="74" fill="url(#t)" letter-spacing="-2">wherever you are.</text>
  <text x="80" y="500" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" fill="#a3adab">Claude Code, Codex, OpenCode and more on a daemon you host.</text>
  <text x="80" y="570" font-family="DejaVu Sans Mono, monospace" font-size="26" fill="#7fd9e6">frogg.app</text>
</svg>`;

const logo = await sharp("src/assets/brand/frogg-logo.png").resize({ width: 190 }).toBuffer();
await sharp(Buffer.from(svg))
  .composite([{ input: logo, left: 80, top: 70 }])
  .png({ compressionLevel: 9, palette: true, quality: 90 })
  .toFile("public/og.png");
console.log("wrote public/og.png");
