import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { root, outputRoot, uiOutput, type BrandBuild } from "./resolve.mjs";

function ico(images: Buffer[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    const size = [16, 32, 48, 64, 128, 256][index];
    header[entry] = size % 256;
    header[entry + 1] = size % 256;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

async function resize(source: string, size: number): Promise<Buffer> {
  return sharp(source)
    .resize(size, size, { fit: "contain", background: "#00000000" })
    .png()
    .toBuffer();
}

export async function generateAssets(build: BrandBuild): Promise<void> {
  const assets = path.join(uiOutput, "assets");
  const publicDir = path.join(uiOutput, "public");
  const icons = path.join(outputRoot, "icons");
  await Promise.all([assets, publicDir, icons].map((dir) => mkdir(dir, { recursive: true })));
  await validateAssets(build);
  const sources = {
    "icon.png": "icon",
    "icon-ios.png": "ios",
    "android-icon-foreground.png": "foreground",
    "notification-icon.png": "notification",
    "splash-icon.png": "splash",
  };
  for (const [name, key] of Object.entries(sources)) {
    const size = key === "notification" ? 96 : 1024;
    const source = build.assetFiles[key] ?? build.assetFiles.icon;
    if (build.brand.legacyFde) {
      await cp(source, path.join(assets, name));
    } else if (key === "notification" && !build.assetFiles.notification) {
      const mask = await resize(source, size);
      await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toFile(path.join(assets, name));
    } else {
      const pipeline = sharp(source).resize(size, size, {
        fit: "contain",
        background: "#00000000",
      });
      if (key === "ios") pipeline.flatten({ background: build.brand.colors.light.background });
      await pipeline.png().toFile(path.join(assets, name));
    }
  }
  for (const appearance of ["light", "dark"] as const) {
    for (const status of ["", "-running", "-attention"]) {
      const name = `favicon-${appearance}${status}.png`;
      if (build.brand.legacyFde) {
        await cp(path.join(root, "apps/ui/assets/images", name), path.join(assets, name));
      } else {
        const source =
          appearance === "light" ? build.assetFiles.faviconLight : build.assetFiles.faviconDark;
        const image = sharp(await resize(source ?? build.assetFiles.icon, 64));
        if (status) {
          const fill = status === "-running" ? "#2563eb" : "#d97706";
          const badge = Buffer.from(
            `<svg width="64" height="64"><circle cx="50" cy="50" r="12" fill="${fill}" stroke="white" stroke-width="3"/></svg>`,
          );
          image.composite([{ input: badge }]);
        }
        await image.png().toFile(path.join(assets, name));
      }
    }
  }
  if (build.brand.legacyFde) {
    await cp(path.join(root, "apps/desktop/src-tauri/icons"), icons, { recursive: true });
    for (const name of [
      "favicon.ico",
      "apple-touch-icon.png",
      "pwa-icon-192.png",
      "pwa-icon-512.png",
    ]) {
      await cp(path.join(root, "apps/ui/public", name), path.join(publicDir, name));
    }
    await cp(
      path.join(root, "apps/ui/assets/images/favicon.png"),
      path.join(assets, "favicon.png"),
    );
  } else {
    for (const [name, size] of Object.entries({
      "32x32.png": 32,
      "64x64.png": 64,
      "128x128.png": 128,
      "128x128@2x.png": 256,
      "icon.png": 1024,
    })) {
      await writeFile(path.join(icons, name), await resize(build.assetFiles.icon, size));
    }
    const icon = ico(
      await Promise.all(
        [16, 32, 48, 64, 128, 256].map((size) => resize(build.assetFiles.icon, size)),
      ),
    );
    await writeFile(path.join(icons, "icon.ico"), icon);
    await writeFile(path.join(publicDir, "favicon.ico"), icon);
    const chunks = [];
    for (const [type, size] of Object.entries({ ic07: 128, ic08: 256, ic09: 512, ic10: 1024 })) {
      const png = await resize(build.assetFiles.icon, size);
      const header = Buffer.alloc(8);
      header.write(type);
      header.writeUInt32BE(png.length + 8, 4);
      chunks.push(header, png);
    }
    const header = Buffer.alloc(8);
    header.write("icns");
    header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
    await writeFile(path.join(icons, "icon.icns"), Buffer.concat([header, ...chunks]));
    for (const [name, size] of Object.entries({
      "apple-touch-icon.png": 180,
      "pwa-icon-192.png": 192,
      "pwa-icon-512.png": 512,
    })) {
      // Separate maskable artwork leaves the required safe zone around the mark.
      await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: build.brand.colors.dark.background,
        },
      })
        .composite([{ input: await resize(build.assetFiles.icon, Math.floor(size * 0.8)) }])
        .png()
        .toFile(path.join(publicDir, name));
    }
    await writeFile(path.join(assets, "favicon.png"), await resize(build.assetFiles.icon, 64));
  }
  await mkdir(path.join(publicDir, "brand"), { recursive: true });
  for (const appearance of ["light", "dark"]) {
    for (const status of ["", "-running", "-attention"]) {
      const name = `favicon-${appearance}${status}.png`;
      await cp(path.join(assets, name), path.join(publicDir, "brand", name));
    }
  }
  const requires = Object.keys(sources).concat([
    "favicon.png",
    ...["light", "dark"].flatMap((mode) =>
      ["", "-running", "-attention"].map((status) => `favicon-${mode}${status}.png`),
    ),
  ]);
  await writeFile(
    path.join(uiOutput, "assets.ts"),
    `// Generated by brand:prepare.\nexport const brandAssets = {\n${requires.map((name) => `  ${JSON.stringify(name)}: require(${JSON.stringify(`./assets/${name}`)}),`).join("\n")}\n};\n`,
  );
  const template = await readFile(path.join(root, "apps/ui/public/index.html"), "utf8");
  await writeFile(path.join(publicDir, "index.html"), template);
}

export async function validateAssets(build: BrandBuild): Promise<void> {
  const metadata = await sharp(build.assetFiles.icon).metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width !== metadata.height ||
    metadata.width < 1024
  ) {
    throw new Error(
      "assets.icon must be a square image at least 1024 × 1024 pixels (or a 1024-square SVG)",
    );
  }
}
