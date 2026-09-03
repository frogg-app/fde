// Settings > Updates for the desktop shell: current version and update
// strategy, release channel, automatic checks, "Check for updates" with the
// last-checked time, and the available release with its notes and a
// Download & install button that shows the shell's download progress.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Download, RefreshCw } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { InstallProgressBar } from "@/desktop/components/local-daemon-bundle-card";
import type { LocalDaemonInstallProgress } from "@/desktop/daemon/local-daemon-install-progress";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import {
  appUpdateProgressFraction,
  describeAppUpdateProgress,
  describeInstallKind,
  type AppUpdateProgress,
} from "@/desktop/updates/app-update-progress";
import {
  formatVersionWithPrefix,
  getDesktopRuntimeInfo,
  type DesktopAppUpdateCheckResult,
  type DesktopUpdateStrategy,
} from "@/desktop/updates/desktop-updates";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { useSettings, type Settings as EffectiveSettings } from "@/hooks/use-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { openExternalUrl } from "@/utils/open-external-url";
import { formatMessageTimestamp } from "@/utils/time";

const RELEASES_URL = "https://github.com/frogg-app/frogg-de/releases";

const ThemedDownload = withUnistyles(Download, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.accentForeground,
}));
const ThemedRefresh = withUnistyles(RefreshCw, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foreground,
}));

/** The bar component is shared with the daemon bundle card; map our phases onto its shape. */
function toBarProgress(progress: AppUpdateProgress): LocalDaemonInstallProgress {
  const fraction = appUpdateProgressFraction(progress);
  if (progress.status !== "active" || fraction === null) {
    return { status: "installing", phase: "download", received: 0, total: null };
  }
  return {
    status: "installing",
    phase: "download",
    received: progress.received,
    total: progress.total ?? progress.received,
  };
}

function formatLastChecked(
  t: (key: string, options?: Record<string, unknown>) => string,
  lastCheckedAt: number | null,
  cachedCheckedAt: number | null | undefined,
): string {
  const timestamp = lastCheckedAt ?? cachedCheckedAt ?? null;
  if (timestamp == null) {
    return t("desktop.updates.section.neverChecked");
  }
  return t("desktop.updates.section.lastChecked", {
    time: formatMessageTimestamp(new Date(timestamp)),
  });
}

function useUpdateStrategy(): DesktopUpdateStrategy | null {
  const [strategy, setStrategy] = useState<DesktopUpdateStrategy | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDesktopRuntimeInfo()
      .then((info) => {
        if (!cancelled) setStrategy(info.updateStrategy);
        return;
      })
      .catch(() => {
        // The strategy line is informational; leave it out when unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return strategy;
}

function useAutoCheckToggle() {
  const { settings, updateSettings } = useDesktopSettings();
  const [isUpdating, setIsUpdating] = useState(false);
  const autoCheck = settings.updates.autoCheck;
  const toggle = useCallback(() => {
    setIsUpdating(true);
    void updateSettings({ updates: { autoCheck: !autoCheck } })
      .catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      })
      .finally(() => setIsUpdating(false));
  }, [autoCheck, updateSettings]);
  return { autoCheck, isUpdating, toggle };
}

interface AvailableUpdateCardProps {
  update: DesktopAppUpdateCheckResult;
  progress: AppUpdateProgress;
  isInstalling: boolean;
  onInstall: () => void;
}

function AvailableUpdateCard({
  update,
  progress,
  isInstalling,
  onInstall,
}: AvailableUpdateCardProps) {
  const { t } = useTranslation();
  const downloadIcon = useMemo(() => <ThemedDownload />, []);
  const barProgress = useMemo(() => toBarProgress(progress), [progress]);
  const openRelease = useCallback(() => {
    void openExternalUrl(update.releaseUrl ?? RELEASES_URL);
  }, [update.releaseUrl]);
  const versionLabel = formatVersionWithPrefix(update.latestVersion);
  const canInstall = update.readyToInstall && !isInstalling;

  return (
    <View style={[settingsStyles.card, styles.availableCard]} testID="desktop-update-available">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("desktop.updates.section.available", { version: versionLabel })}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {update.readyToInstall
              ? describeInstallKind(update.installKind)
              : t("desktop.updates.section.noAsset")}
          </Text>
        </View>
        <View style={styles.actionGroup}>
          <Button variant="outline" size="sm" onPress={openRelease}>
            {t("desktop.updates.section.viewOnGithub")}
          </Button>
          <Button
            size="sm"
            leftIcon={downloadIcon}
            onPress={onInstall}
            disabled={!canInstall}
            testID="desktop-update-install"
          >
            {isInstalling
              ? t("desktop.updates.section.installing")
              : t("desktop.updates.section.downloadAndInstall")}
          </Button>
        </View>
      </View>
      {progress.status === "active" ? (
        <View style={styles.progressRow}>
          <InstallProgressBar progress={barProgress} />
          <Text style={styles.progressText}>{describeAppUpdateProgress(progress)}</Text>
        </View>
      ) : null}
      {update.notes ? (
        <View style={styles.notes} testID="desktop-update-notes">
          <Text style={styles.notesTitle}>{t("desktop.updates.section.releaseNotes")}</Text>
          <MarkdownRenderer text={update.notes} compact />
        </View>
      ) : null}
    </View>
  );
}

export function DesktopUpdatesSection({ appVersion }: { appVersion: string | null }) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const strategy = useUpdateStrategy();
  const {
    autoCheck,
    isUpdating: isUpdatingAutoCheck,
    toggle: toggleAutoCheck,
  } = useAutoCheckToggle();
  const {
    isDesktopApp,
    status,
    statusText,
    availableUpdate,
    errorMessage,
    lastCheckedAt,
    isChecking,
    isInstalling,
    progress,
    checkForUpdates,
    installUpdate,
  } = useDesktopAppUpdater();

  const handleReleaseChannelChange = useCallback(
    (releaseChannel: EffectiveSettings["releaseChannel"]) => {
      void updateSettings({ releaseChannel });
    },
    [updateSettings],
  );
  const releaseChannelOptions = useMemo(
    () => [
      { value: "stable" as const, label: t("settings.about.releaseChannel.stable") },
      { value: "beta" as const, label: t("settings.about.releaseChannel.beta") },
    ],
    [t],
  );
  const refreshIcon = useMemo(() => <ThemedRefresh />, []);

  const handleCheck = useCallback(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  const handleInstall = useCallback(() => {
    void confirmDialog({
      title: t("settings.about.updates.installTitle"),
      message: t("settings.about.updates.installMessage"),
      confirmLabel: t("settings.about.updates.installConfirm"),
      cancelLabel: t("common.actions.cancel"),
    })
      .then((confirmed) => {
        if (confirmed) {
          void installUpdate();
        }
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to open app update confirmation", error);
        Alert.alert(
          t("settings.about.updates.alertTitle"),
          t("settings.about.updates.alertMessage"),
        );
      });
  }, [installUpdate, t]);

  if (!isDesktopApp) {
    return null;
  }

  const lastCheckedText = formatLastChecked(t, lastCheckedAt, availableUpdate?.checkedAt);
  const showAvailable =
    availableUpdate !== null && (status === "available" || status === "pending" || isInstalling);

  return (
    <SettingsSection title={t("desktop.updates.section.title")} testID="desktop-updates-section">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("desktop.updates.section.currentVersion")}
            </Text>
            {strategy ? (
              <Text style={settingsStyles.rowHint}>
                {strategy === "tauri-signed"
                  ? t("desktop.updates.section.strategySigned")
                  : t("desktop.updates.section.strategyGithub")}
              </Text>
            ) : null}
          </View>
          <Text style={styles.valueText} testID="desktop-updates-current-version">
            {formatVersionWithPrefix(appVersion)}
          </Text>
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.about.releaseChannel.label")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.about.releaseChannel.description")}
            </Text>
          </View>
          <SegmentedControl
            size="sm"
            value={settings.releaseChannel}
            onValueChange={handleReleaseChannelChange}
            options={releaseChannelOptions}
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("desktop.updates.section.autoCheck.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("desktop.updates.section.autoCheck.hint")}
            </Text>
          </View>
          <Switch
            value={autoCheck}
            onValueChange={toggleAutoCheck}
            disabled={isUpdatingAutoCheck}
            accessibilityLabel={t("desktop.updates.section.autoCheck.title")}
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("desktop.updates.section.check")}</Text>
            <Text style={settingsStyles.rowHint}>{statusText}</Text>
            <Text style={settingsStyles.rowHint}>{lastCheckedText}</Text>
            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
            {status === "installed" ? (
              <Text style={styles.noticeText}>{t("desktop.updates.section.restartRequired")}</Text>
            ) : null}
          </View>
          <Button
            variant="outline"
            size="sm"
            leftIcon={refreshIcon}
            onPress={handleCheck}
            disabled={isChecking || isInstalling}
            testID="desktop-update-check"
          >
            {isChecking
              ? t("desktop.updates.section.checking")
              : t("desktop.updates.section.check")}
          </Button>
        </View>
      </View>
      {showAvailable && availableUpdate ? (
        <AvailableUpdateCard
          update={availableUpdate}
          progress={progress}
          isInstalling={isInstalling}
          onInstall={handleInstall}
        />
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  valueText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  noticeText: {
    color: theme.colors.palette.amber[500],
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  actionGroup: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  availableCard: {
    marginTop: theme.spacing[3],
  },
  progressRow: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  progressText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  notes: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
  notesTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
}));
