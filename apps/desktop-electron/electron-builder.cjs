// Electron is the production desktop shell.
const path = require("node:path");
const { loadBrand } = require("../../scripts/dev/branding/load.cjs");

function createConfig(brand) {
  const productName = brand.name;
  const account = process.env.TRUSTED_SIGNING_ACCOUNT;
  let azureSignOptions;
  if (account) {
    const endpoint = process.env.TRUSTED_SIGNING_ENDPOINT;
    const profile = process.env.TRUSTED_SIGNING_PROFILE;
    if (!endpoint || !profile)
      throw new Error("Trusted Signing requires endpoint and certificate profile.");
    azureSignOptions = {
      endpoint,
      codeSigningAccountName: account,
      certificateProfileName: profile,
      publisherName: brand.publisher,
    };
  }
  const artifactName = `${brand.artifactPrefix}-\${version}-\${os}-\${arch}.\${ext}`;
  const icons = path.resolve(__dirname, "../../.generated/branding/icons");
  const windowsInstaller = path.resolve(__dirname, "../../.generated/branding/windows-installer");
  return {
    appId: brand.applicationId,
    productName,
    executableName: brand.id,
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
    protocols: [{ name: brand.name, schemes: [brand.scheme] }],
    publish: null,
    mac: {
      category: "public.app-category.developer-tools",
      icon: path.join(icons, "icon.icns"),
      target: ["dmg", "zip"],
      hardenedRuntime: true,
      notarize: false,
      extendInfo: {
        NSMicrophoneUsageDescription: "Use your microphone for voice conversations.",
      },
    },
    linux: {
      category: "Development",
      icon: path.join(icons, "icon.png"),
      target: ["AppImage", "deb", "tar.gz"],
      maintainer: `${brand.publisher} <hello@frogg.app>`,
    },
    win: {
      icon: path.join(icons, "icon.ico"),
      target: ["nsis", "zip"],
      ...(azureSignOptions ? { azureSignOptions } : {}),
    },
    // One-click per-user installer; brand:prepare generates the UI include and artwork.
    // The include also migrates older per-machine installs (see windows-installer.nsh).
    nsis: {
      oneClick: true,
      perMachine: false,
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
      include: path.join(windowsInstaller, "installer.nsh"),
      installerIcon: path.join(icons, "icon.ico"),
      uninstallerIcon: path.join(icons, "icon.ico"),
      shortcutName: productName,
      uninstallDisplayName: productName,
    },
  };
}
module.exports = createConfig(loadBrand());
