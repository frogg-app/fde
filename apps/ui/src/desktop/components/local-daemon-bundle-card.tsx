import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Download } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import type { LocalDaemonBundleStatus } from "@/desktop/daemon/desktop-daemon";
import {
  APPROXIMATE_BUNDLE_SIZE_BYTES,
  formatBytes,
  formatInstallProgress,
  installProgressFraction,
  type LocalDaemonInstallProgress,
} from "@/desktop/daemon/local-daemon-install-progress";

const ThemedDownload = withUnistyles(Download, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.accentForeground,
}));

interface LocalDaemonBundleCardProps {
  bundle: LocalDaemonBundleStatus | null;
  bundleError: string | null;
  progress: LocalDaemonInstallProgress;
  isInstalling: boolean;
  onInstall: () => void;
}

export function InstallProgressBar({ progress }: { progress: LocalDaemonInstallProgress }) {
  const fraction = installProgressFraction(progress);
  const fillStyle = useMemo(
    () => [styles.progressFill, { width: `${Math.round((fraction ?? 0.35) * 100)}%` as const }],
    [fraction],
  );
  return (
    <View style={styles.progressTrack} accessibilityRole="progressbar">
      <View style={fillStyle} />
    </View>
  );
}

export function describeInstallProgress(
  progress: LocalDaemonInstallProgress,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (progress.status !== "installing") {
    return "";
  }
  switch (progress.phase) {
    case "checksum":
      return t("desktop.daemon.bundle.phaseChecksum");
    case "extract":
      return t("desktop.daemon.bundle.phaseExtract");
    default:
      return t("desktop.daemon.bundle.phaseDownload", {
        progress: formatInstallProgress(progress) ?? "",
      });
  }
}

function describeBundle(
  bundle: LocalDaemonBundleStatus | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (bundle?.installed) {
    return t("desktop.daemon.bundle.installedHint", {
      version: bundle.version ?? "?",
      path: bundle.path ?? "",
    });
  }
  return t("desktop.daemon.bundle.notInstalledHint", {
    platform: `${bundle?.platform ?? ""}-${bundle?.arch ?? ""}`,
  });
}

/**
 * Bundle row for the daemon settings section: what is installed, or an
 * Install button with a progress bar while the shell downloads the bundle.
 */
export function LocalDaemonBundleCard(props: LocalDaemonBundleCardProps) {
  const { bundle, bundleError, progress, isInstalling, onInstall } = props;
  const { t } = useTranslation();
  const downloadIcon = useMemo(() => <ThemedDownload />, []);
  const installed = bundle?.installed === true;
  const hint = bundleError ?? describeBundle(bundle, t);

  return (
    <View style={settingsStyles.card} testID="local-daemon-bundle-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("desktop.daemon.bundle.title")}</Text>
          <Text style={settingsStyles.rowHint}>{hint}</Text>
        </View>
        {installed ? (
          <Text style={styles.valueText}>{t("desktop.daemon.bundle.installed")}</Text>
        ) : (
          <Button
            size="sm"
            leftIcon={downloadIcon}
            onPress={onInstall}
            disabled={isInstalling}
            testID="local-daemon-bundle-install"
          >
            {isInstalling
              ? t("desktop.daemon.bundle.installing")
              : t("desktop.daemon.bundle.install", {
                  size: formatBytes(APPROXIMATE_BUNDLE_SIZE_BYTES),
                })}
          </Button>
        )}
      </View>
      {progress.status === "installing" ? (
        <View style={styles.progressRow}>
          <InstallProgressBar progress={progress} />
          <Text style={styles.progressText}>{describeInstallProgress(progress, t)}</Text>
        </View>
      ) : null}
      {progress.status === "error" ? (
        <View style={styles.progressRow}>
          <Text style={styles.errorText}>
            {t("desktop.daemon.bundle.installFailed", { message: progress.message })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  valueText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  progressRow: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  progressText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.palette.red[500],
    fontSize: theme.fontSize.sm,
  },
}));
