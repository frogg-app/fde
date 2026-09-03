import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  DaemonUpdateChannel,
  DaemonUpdateCheckResponse,
  DaemonUpdateGetStatusResponse,
  DaemonUpdateRun,
} from "@fde/protocol/messages";
import { Alert as InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { hasDaemonReconnectedAfter, type DaemonConnectionMarker } from "./daemon-reconnect";

/**
 * Daemon self-update for any host whose daemon is a versioned install:
 * check the release channel, update with progress, and show the supervisor's
 * outcome (applied or rolled back) once the daemon is back. Also the opt-in
 * auto-update toggle and channel, stored in the daemon's config.json.
 */
type StatusPayload = DaemonUpdateGetStatusResponse["payload"];
type CheckPayload = DaemonUpdateCheckResponse["payload"];

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "checked"; result: CheckPayload }
  | { kind: "error"; message: string };

type RunState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running"; run: DaemonUpdateRun }
  | { kind: "reconnecting"; run: DaemonUpdateRun }
  | { kind: "error"; message: string };

const RECONNECT_TIMEOUT_MS = 4 * 60_000;
const RECONNECT_POLL_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function HostDaemonUpdateSection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const { config, patchConfig } = useDaemonConfig(host.serverId);
  const supported = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.features?.daemonUpdateRuns === true,
  );
  const desktopManaged = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.desktopManaged === true,
  );
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!daemonClient || !supported) return null;
    try {
      const next = await daemonClient.getDaemonUpdateStatus();
      if (mounted.current) setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, [daemonClient, supported]);

  useEffect(() => {
    if (!isConnected) return;
    void refreshStatus();
  }, [isConnected, refreshStatus]);

  // Progress is broadcast to every session, so a run started elsewhere shows too.
  useEffect(() => {
    if (!daemonClient || !supported) return;
    return daemonClient.on("daemon.update.run.progress", (message) => {
      if (!mounted.current) return;
      const progress = message.payload;
      if (progress.phase === "failed") {
        setRun({ kind: "error", message: progress.message ?? t("settings.host.daemon.selfUpdate.phases.failed") });
        void refreshStatus();
        return;
      }
      setRun((current) =>
        current.kind === "reconnecting" ? current : { kind: "running", run: progress },
      );
    });
  }, [daemonClient, refreshStatus, supported, t]);

  const waitForOutcome = useCallback(
    async (marker: DaemonConnectionMarker | null, activeRun: DaemonUpdateRun) => {
      setRun({ kind: "reconnecting", run: activeRun });
      const runtime = getHostRuntimeStore();
      const deadline = Date.now() + RECONNECT_TIMEOUT_MS;
      while (Date.now() < deadline && mounted.current) {
        if (hasDaemonReconnectedAfter(runtime.getSnapshot(host.serverId), marker)) {
          const next = await refreshStatus();
          if (next?.lastResult && next.lastResult.at > activeRun.at) {
            setRun({ kind: "idle" });
            setCheck({ kind: "idle" });
            return;
          }
        }
        await delay(RECONNECT_POLL_MS);
      }
      if (mounted.current) {
        setRun({ kind: "error", message: t("settings.host.daemon.selfUpdate.unableToReconnect", { name: host.label }) });
      }
    },
    [host.label, host.serverId, refreshStatus, t],
  );

  useEffect(() => {
    if (run.kind !== "running" || run.run.phase !== "restart") return;
    const snapshot = getHostRuntimeStore().getSnapshot(host.serverId);
    const marker = snapshot
      ? { clientGeneration: snapshot.clientGeneration, lastOnlineAt: snapshot.lastOnlineAt }
      : null;
    void waitForOutcome(marker, run.run);
  }, [host.serverId, run, waitForOutcome]);

  const channel: DaemonUpdateChannel = config?.autoUpdate?.channel ?? "stable";

  const handleCheck = useCallback(async () => {
    if (!daemonClient) return;
    setCheck({ kind: "checking" });
    try {
      const result = await daemonClient.checkDaemonUpdate({ channel });
      if (mounted.current) setCheck({ kind: "checked", result });
    } catch (error) {
      if (mounted.current) {
        setCheck({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }
  }, [channel, daemonClient]);

  const handleUpdate = useCallback(
    async (version: string) => {
      if (!daemonClient) return;
      const confirmed = await confirmDialog({
        title: t("settings.host.daemon.selfUpdate.confirmTitle", { name: host.label, version }),
        message: t("settings.host.daemon.selfUpdate.confirmMessage"),
        confirmLabel: t("settings.host.daemon.selfUpdate.confirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: false,
      }).catch(() => false);
      if (!confirmed || !mounted.current) return;
      setRun({ kind: "starting" });
      try {
        const started = await daemonClient.startDaemonUpdate({ version, channel });
        if (!started.accepted) {
          setRun({ kind: "error", message: started.error ?? t("settings.host.daemon.selfUpdate.phases.failed") });
        }
      } catch (error) {
        setRun({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    [channel, daemonClient, host.label, t],
  );

  const handleAutoUpdatePatch = useCallback(
    (patch: { enabled?: boolean; channel?: DaemonUpdateChannel }) => {
      void patchConfig({ autoUpdate: patch }).catch((error) => {
        console.error("[HostDaemonUpdateSection] Failed to save auto-update settings", error);
      });
    },
    [patchConfig],
  );

  if (!supported || desktopManaged) return null;

  const version = status?.currentVersion ?? null;
  const updatable = status?.updatable ?? false;
  const busy = run.kind === "starting" || run.kind === "running" || run.kind === "reconnecting";
  const available =
    check.kind === "checked" && check.result.updateAvailable ? check.result.latestVersion : null;
  const lastResult = status?.lastResult ?? null;

  const checkHint = (() => {
    if (!updatable) return status?.reason ?? t("settings.host.daemon.selfUpdate.notUpdatable");
    if (check.kind === "checking") return t("settings.host.daemon.selfUpdate.checking");
    if (check.kind === "error") return t("settings.host.daemon.selfUpdate.checkFailed", { error: check.message });
    if (check.kind === "checked") {
      if (check.result.error) return t("settings.host.daemon.selfUpdate.checkFailed", { error: check.result.error });
      return available
        ? t("settings.host.daemon.selfUpdate.available", { version: available })
        : t("settings.host.daemon.selfUpdate.upToDate");
    }
    return t("settings.host.daemon.selfUpdate.hint");
  })();

  const runLabel = (() => {
    if (run.kind === "starting") return t("settings.host.daemon.selfUpdate.phases.check");
    if (run.kind === "running") {
      const phase = run.run.phase;
      const known = ["check", "download", "verify", "install", "restart"];
      return known.includes(phase)
        ? t(`settings.host.daemon.selfUpdate.phases.${phase}`)
        : (run.run.message ?? phase);
    }
    if (run.kind === "reconnecting") return t("settings.host.daemon.selfUpdate.reconnecting");
    return null;
  })();

  return (
    <SettingsSection
      title={t("settings.host.daemon.selfUpdate.title")}
      info={t("settings.host.daemon.selfUpdate.info")}
      testID="host-page-daemon-update"
    >
      <View style={settingsStyles.card}>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {version
                ? t("settings.host.daemon.selfUpdate.versionLabel", { version })
                : t("settings.host.daemon.selfUpdate.versionUnknown")}
            </Text>
            <Text style={settingsStyles.rowHint}>{checkHint}</Text>
          </View>
          {updatable && !available ? (
            <Button
              variant="outline"
              size="sm"
              onPress={() => void handleCheck()}
              disabled={!isConnected || busy || check.kind === "checking"}
              testID="host-page-daemon-update-check"
            >
              {t("settings.host.daemon.selfUpdate.check")}
            </Button>
          ) : null}
          {updatable && available ? (
            <Button
              variant="default"
              size="sm"
              onPress={() => void handleUpdate(available)}
              disabled={!isConnected || busy}
              testID="host-page-daemon-update-start"
            >
              {runLabel ?? t("settings.host.daemon.selfUpdate.update", { version: available })}
            </Button>
          ) : null}
        </View>
        {run.kind === "error" ? (
          <View style={styles.alert}>
            <InlineAlert
              variant="error"
              title={t("settings.host.daemon.selfUpdate.startFailedTitle")}
              description={run.message}
              testID="host-page-daemon-update-error"
            />
          </View>
        ) : null}
        {runLabel && run.kind !== "starting" && available === null ? (
          <View style={styles.alert}>
            <InlineAlert variant="info" description={runLabel} />
          </View>
        ) : null}
        {lastResult ? (
          <View style={styles.alert}>
            <InlineAlert
              variant={
                lastResult.status === "applied"
                  ? "success"
                  : lastResult.status === "rolled_back"
                    ? "warning"
                    : "error"
              }
              title={t(`settings.host.daemon.selfUpdate.outcome.${lastResult.status}`, {
                from: lastResult.from ?? "?",
                to: lastResult.to,
              })}
              description={[
                lastResult.reason,
                t("settings.host.daemon.selfUpdate.logHint", {
                  installDir: status?.installDir ?? "",
                }),
              ]
                .filter(Boolean)
                .join(" ")}
              testID="host-page-daemon-update-outcome"
            />
          </View>
        ) : null}
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.daemon.selfUpdate.autoUpdate.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.host.daemon.selfUpdate.autoUpdate.hint")}
            </Text>
          </View>
          <Switch
            value={config?.autoUpdate?.enabled === true}
            onValueChange={(enabled) => handleAutoUpdatePatch({ enabled })}
            disabled={!isConnected || !updatable}
            accessibilityLabel={t("settings.host.daemon.selfUpdate.autoUpdate.title")}
            testID="host-page-daemon-auto-update-switch"
          />
        </View>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.daemon.selfUpdate.autoUpdate.channelLabel")}
            </Text>
          </View>
          <View style={styles.channelRow}>
            {(["stable", "beta"] as const).map((option) => (
              <Button
                key={option}
                variant={channel === option ? "default" : "outline"}
                size="sm"
                onPress={() => handleAutoUpdatePatch({ channel: option })}
                disabled={!isConnected || busy}
                testID={`host-page-daemon-update-channel-${option}`}
              >
                {t(`settings.host.daemon.selfUpdate.autoUpdate.${option}`)}
              </Button>
            ))}
          </View>
        </View>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  alert: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  channelRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
