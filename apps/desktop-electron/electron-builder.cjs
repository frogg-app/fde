// Keep comparison installations and artifacts separate from the Tauri release channel.
const path = require("node:path");
const { loadBrand } = require("../../scripts/dev/branding/load.cjs");

function createConfig(brand) {
  const productName = `${brand.name} Electron`;
  const artifactName = `${brand.artifactPrefix}-Electron-\${version}-\${os}-\${arch}.\${ext}`;
  const icons = path.resolve(__dirname, "../../.generated/branding/icons");
  return {
    appId: `${brand.applicationId}.electron`,
    productName,
    executableName: `${brand.id}-electron`,
    artifactName,
    npmRebuild: false,
    asar: true,
    directories: { output: "release" },
    files: [
      "dist/**/*",
      "!**/*.map",
      "!**/*.test.*",
      "!dist/daemon/!(local-transport|transport-endpoint|ssh-password).*",
      "!dist/integrations/cli-install/**/*",
      "!dist/daemon/cli/**/*",
    ],
    extraResources: [
      { from: "../ui/dist", to: "app-dist" },
      { from: "../../.generated/branding/brand.json", to: "brand.json" },
      { from: path.join(icons, "icon.png"), to: "icon.png" },
    ],
    // A comparison build must never register over the installed Tauri deep-link handler.
    publish: null,
    mac: {
      category: "public.app-category.developer-tools",
      icon: path.join(icons, "icon.icns"),
      target: ["dmg", "zip"],
      hardenedRuntime: true,
      notarize: false,
      extendInfo: { NSMicrophoneUsageDescription: "Use your microphone for voice conversations." },
    },
    linux: {
      category: "Development",
      icon: path.join(icons, "icon.png"),
      target: ["AppImage", "deb", "tar.gz"],
      maintainer: `${brand.publisher} <hello@frogg.app>`,
    },
    win: { icon: path.join(icons, "icon.ico"), target: ["nsis", "zip"] },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  };
}
module.exports = createConfig(loadBrand());
