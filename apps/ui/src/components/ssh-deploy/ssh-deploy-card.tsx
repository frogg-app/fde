import { RotateCw } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SshDeployForm } from "@/components/ssh-deploy/ssh-deploy-form";
import { SshDeployLog } from "@/components/ssh-deploy/ssh-deploy-log";
import { SshDeployProbeSummary } from "@/components/ssh-deploy/ssh-deploy-probe-summary";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import {
  defaultSshDeployListen,
  sshDeployPrimaryAction,
  startSshDeploy,
  uninstallSshDeploy,
  type SshDeployMethod,
  type SshDeployTarget,
} from "@/desktop/ssh-deploy/ssh-deploy";
import { useSshDeployJob, type SshDeployAction } from "@/desktop/ssh-deploy/use-ssh-deploy-job";
import type { SshDeployProbeState } from "@/desktop/ssh-deploy/use-ssh-deploy-probe";
import { settingsStyles } from "@/styles/settings";
import { resolveAppVersion } from "@/utils/app-version";
import { confirmDialog } from "@/utils/confirm-dialog";

const ThemedRotateCw = withUnistyles(RotateCw);

const styles = StyleSheet.create((theme) => ({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  probeError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
}));

export interface SshDeployCardProps {
  target: SshDeployTarget;
  /** The daemon port the host was saved with; the listen default follows it. */
  daemonPort?: number;
  probe: SshDeployProbeState;
  onRefreshProbe: () => void;
  /** Called after a successful deploy or upgrade (not after an uninstall). */
  onDeployed?: () => void;
  testID?: string;
}

/**
 * "Daemon on this host": probe results, method/listen/version, and the
 * Deploy / Upgrade / Uninstall actions with the job's live output beneath.
 */
export function SshDeployCard({
  target,
  daemonPort,
  probe,
  onRefreshProbe,
  onDeployed,
  testID,
}: SshDeployCardProps) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<SshDeployMethod>("native");
  const defaultListen = defaultSshDeployListen(daemonPort);
  const defaultVersion = resolveAppVersion() ?? "";
  const listenRef = useRef(defaultListen);
  const versionRef = useRef(defaultVersion);
  const handleFinished = useCallback(
    (action: SshDeployAction) => {
      onRefreshProbe();
      if (action !== "uninstall") onDeployed?.();
    },
    [onDeployed, onRefreshProbe],
  );
  const job = useSshDeployJob(handleFinished);
  const isRunning = job.state.status === "running";

  const handleListenChange = useCallback((value: string) => {
    listenRef.current = value;
  }, []);
  const handleVersionChange = useCallback((value: string) => {
    versionRef.current = value;
  }, []);

  const handleDeploy = useCallback(
    (action: SshDeployAction) => {
      void job.run(action, () =>
        startSshDeploy({
          ...target,
          method,
          listen: listenRef.current.trim() || defaultListen,
          ...(versionRef.current.trim() ? { version: versionRef.current.trim() } : {}),
        }),
      );
    },
    [defaultListen, job, method, target],
  );

  const handleUninstall = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("settings.host.sshDeploy.uninstall.title"),
      message: t("settings.host.sshDeploy.uninstall.message", { host: target.host }),
      confirmLabel: t("settings.host.sshDeploy.actions.uninstall"),
      cancelLabel: t("settings.host.sshDeploy.actions.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    await job.run("uninstall", () => uninstallSshDeploy({ ...target, method }));
  }, [job, method, t, target]);

  let badgeLabel: string;
  let badgeVariant: StatusBadgeVariant = "muted";
  if (probe.status === "probing") {
    badgeLabel = t("settings.host.sshDeploy.status.probing");
  } else if (probe.status === "failed") {
    badgeLabel = t("settings.host.sshDeploy.status.unreachable");
    badgeVariant = "error";
  } else if (probe.probe.hasFde.installed) {
    badgeLabel = probe.probe.hasFde.version
      ? t("settings.host.sshDeploy.status.installed", { version: probe.probe.hasFde.version })
      : t("settings.host.sshDeploy.status.installedUnknown");
    badgeVariant = "success";
  } else if (probe.probe.hasDockerContainer) {
    badgeLabel = t("settings.host.sshDeploy.status.container");
    badgeVariant = "success";
  } else {
    badgeLabel = t("settings.host.sshDeploy.status.notInstalled");
    badgeVariant = "warning";
  }

  const ready = probe.status === "ready" ? probe.probe : null;
  const primaryAction = ready
    ? sshDeployPrimaryAction(ready, method, versionRef.current.trim() || defaultVersion || null)
    : "deploy";
  const canUninstall =
    ready !== null && (method === "docker" ? ready.hasDockerContainer : ready.hasFde.installed);
  const handlePrimary = useCallback(
    () => handleDeploy(primaryAction),
    [handleDeploy, primaryAction],
  );

  return (
    <View style={settingsStyles.card} testID={testID ?? "ssh-deploy-card"}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.sshDeploy.title")}</Text>
          <Text style={settingsStyles.rowHint}>{target.host}</Text>
        </View>
        <StatusBadge label={badgeLabel} variant={badgeVariant} />
      </View>
      {probe.status === "failed" ? (
        <Text style={styles.probeError} testID="ssh-deploy-probe-error">
          {t("settings.host.sshDeploy.probe.failed", { detail: probe.error })}
        </Text>
      ) : null}
      {ready ? <SshDeployProbeSummary probe={ready} /> : null}
      {ready ? (
        <SshDeployForm
          probe={ready}
          method={method}
          onMethodChange={setMethod}
          initialListen={defaultListen}
          onListenChange={handleListenChange}
          initialVersion={defaultVersion}
          onVersionChange={handleVersionChange}
          disabled={isRunning}
        />
      ) : null}
      <View style={styles.actions}>
        {ready ? (
          <Button
            variant="default"
            size="sm"
            onPress={handlePrimary}
            disabled={isRunning}
            testID="ssh-deploy-primary"
          >
            {t(`settings.host.sshDeploy.actions.${primaryAction}`)}
          </Button>
        ) : null}
        {canUninstall ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleUninstall}
            disabled={isRunning}
            testID="ssh-deploy-uninstall"
          >
            {t("settings.host.sshDeploy.actions.uninstall")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={ThemedRotateCw}
          onPress={onRefreshProbe}
          disabled={probe.status === "probing" || isRunning}
          testID="ssh-deploy-refresh"
        >
          {t("settings.host.sshDeploy.actions.refresh")}
        </Button>
      </View>
      <SshDeployLog
        host={target.host}
        state={job.state}
        lines={job.lines}
        onCancel={job.cancel}
        testID="ssh-deploy-log"
      />
    </View>
  );
}
