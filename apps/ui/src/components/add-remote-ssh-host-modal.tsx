import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Terminal } from "lucide-react-native";
import { DEFAULT_SSH_DAEMON_PORT, type SshTransportTarget } from "@fde/protocol/ssh-transport";
import type { HostProfile } from "@/types/host-connection";
import { isElectronRuntime } from "@/desktop/host";
import {
  forgetSessionSshPassword,
  rememberSessionSshPassword,
} from "@/desktop/daemon/ssh-session-passwords";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";
import { SSH_DEPLOY_RECONNECT_GRACE_MS } from "@/desktop/ssh-deploy/ssh-deploy";
import { AdaptiveModalSheet, type SheetHeader } from "./adaptive-modal-sheet";
import { RemoteSshDeployOffer } from "./remote-ssh-deploy-offer";
import { classifyRemoteSshFailure, type RemoteSshFailure } from "./remote-ssh-failure";
import { RemoteSshPasswordFields } from "./remote-ssh-password-fields";
import {
  resolveRemoteSshTarget,
  type RemoteSshFormError,
  type RemoteSshMode,
} from "./remote-ssh-target";
import { SshConfigHostPicker, useSshConfigHosts } from "./ssh-config-host-picker";

const FLEX_ONE_STYLE = { flex: 1 } as const;
const ThemedTerminal = withUnistyles(Terminal);

const styles = StyleSheet.create((theme) => ({
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  tabs: {
    alignSelf: "flex-start",
  },
  connectionError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));

export interface AddRemoteSshHostModalProps {
  visible: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSaved?: (result: {
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

const FAILURE_MESSAGE_KEYS: Record<RemoteSshFailure["kind"], string> = {
  "daemon-password-required": "pairing.remoteSsh.errors.daemonPasswordRequired",
  "daemon-password-incorrect": "pairing.remoteSsh.errors.daemonPasswordIncorrect",
  "ssh-auth": "pairing.remoteSsh.errors.sshPasswordRequired",
  "ssh-host-key": "pairing.remoteSsh.errors.sshHostKey",
};

/**
 * What a failed connect asks of the user and the message that says so: a
 * classified failure gets its own copy (the daemon's password versus ssh's,
 * a rejected ssh password, a host key); anything else shows ssh's text.
 */
function describeConnectFailure(input: {
  error: unknown;
  host: string;
  sshPasswordTried: boolean;
  t: TFunction;
}): { failure: RemoteSshFailure | null; message: string } {
  const failure = classifyRemoteSshFailure(input.error);
  if (failure) {
    const key =
      failure.kind === "ssh-auth" && input.sshPasswordTried
        ? "pairing.remoteSsh.errors.sshPasswordIncorrect"
        : FAILURE_MESSAGE_KEYS[failure.kind];
    return { failure, message: input.t(key, { host: input.host }) };
  }
  return {
    failure: null,
    message:
      input.error instanceof DaemonConnectionTestError
        ? input.t("pairing.remoteSsh.errors.failedToConnect", { detail: input.error.message })
        : input.t("common.errors.unableToSave"),
  };
}

export function AddRemoteSshHostModal({
  visible,
  onClose,
  onCancel,
  onSaved,
}: AddRemoteSshHostModalProps) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const isCompact = useIsCompactFormFactor();
  const { probeAndUpsertRemoteSshConnection } = useHostMutations();
  const hasDesktopBridge = isElectronRuntime();
  const configHosts = useSshConfigHosts();

  const manualTargetRef = useRef("");
  const manualInputRef = useRef<EditingTextInputHandle>(null);
  const daemonPortRef = useRef("");
  const daemonPasswordRef = useRef("");
  const sshPasswordRef = useRef("");
  const [chosenMode, setChosenMode] = useState<RemoteSshMode | null>(null);
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<RemoteSshFormError | null>(null);
  const [connectionError, setConnectionError] = useState("");
  // What the last failure asked for; decides which password field shows.
  const [failure, setFailure] = useState<RemoteSshFailure | null>(null);
  const [rememberSshPassword, setRememberSshPassword] = useState(true);
  // The target of the last failed connect: the deploy offer probes it.
  const [failedTarget, setFailedTarget] = useState<SshTransportTarget | null>(null);

  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.remoteSsh.title") }), [t]);
  const size = isCompact ? "md" : "sm";
  // SSH config is the default while the shell can list hosts and found some;
  // a user's explicit tab choice sticks for the life of the sheet.
  const mode: RemoteSshMode = !hasDesktopBridge
    ? "manual"
    : (chosenMode ?? (configHosts === undefined || configHosts.length > 0 ? "config" : "manual"));
  const tabOptions = useMemo<SegmentedControlOption<RemoteSshMode>[]>(
    () => [
      {
        value: "config",
        label: t("pairing.remoteSsh.tabs.config"),
        testID: "remote-ssh-tab-config",
      },
      {
        value: "manual",
        label: t("pairing.remoteSsh.tabs.manual"),
        testID: "remote-ssh-tab-manual",
      },
    ],
    [t],
  );
  const clear = useCallback(() => {
    manualTargetRef.current = "";
    manualInputRef.current?.replaceText("");
    daemonPortRef.current = "";
    daemonPasswordRef.current = "";
    sshPasswordRef.current = "";
    setChosenMode(null);
    setSelectedAlias(null);
    setFormError(null);
    setConnectionError("");
    setFailure(null);
    setRememberSshPassword(true);
    setFailedTarget(null);
  }, []);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    clear();
    onClose();
  }, [clear, isSaving, onClose]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    clear();
    (onCancel ?? onClose)();
  }, [clear, isSaving, onCancel, onClose]);

  const handleModeChange = useCallback((next: RemoteSshMode) => {
    setChosenMode(next);
    setFormError(null);
    setConnectionError("");
    setFailure(null);
  }, []);

  const handleSelectAlias = useCallback((alias: string) => {
    setSelectedAlias(alias);
    setFormError(null);
    setConnectionError("");
    setFailure(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const resolved = resolveRemoteSshTarget({
      mode,
      selectedAlias,
      daemonPortText: daemonPortRef.current,
      manualTarget: manualTargetRef.current,
    });
    if (!resolved.ok) {
      setFormError(resolved.error);
      return;
    }
    const { target } = resolved;
    const sshKey = {
      host: target.host,
      ...(target.sshPort !== undefined ? { sshPort: target.sshPort } : {}),
    };
    // The ssh password goes to the in-memory session store, which the
    // desktop transport reads when it opens the session; it is never part
    // of the connection that gets persisted.
    const sshPassword = sshPasswordRef.current;
    const sshPasswordTried = sshPassword.length > 0;
    if (sshPasswordTried) {
      rememberSessionSshPassword(sshKey, sshPassword);
    }
    const daemonPassword = daemonPasswordRef.current.trim();

    let result: Awaited<ReturnType<typeof probeAndUpsertRemoteSshConnection>>;
    try {
      setIsSaving(true);
      setFormError(null);
      setConnectionError("");
      setFailedTarget(null);
      result = await probeAndUpsertRemoteSshConnection({
        ...target,
        ...(daemonPassword ? { password: daemonPassword } : {}),
      });
    } catch (error) {
      const outcome = describeConnectFailure({ error, host: target.host, sshPasswordTried, t });
      setFailure(outcome.failure);
      setConnectionError(outcome.message);
      if (outcome.failure?.kind === "ssh-auth" && sshPasswordTried) {
        // A rejected password must not be retried by reconnects or probes.
        forgetSessionSshPassword(sshKey);
      }
      // ssh reached the host and the daemon answered, or ssh itself needs
      // something from the user: no point probing for a missing daemon.
      if (hasDesktopBridge && outcome.failure === null) setFailedTarget(target);
      return;
    } finally {
      setIsSaving(false);
    }

    if (sshPasswordTried && !rememberSshPassword) {
      forgetSessionSshPassword(sshKey);
    }
    clear();
    onClose();
    onSaved?.({
      ...result,
      isNewHost: !hosts.some((profile) => profile.serverId === result.serverId),
    });
  }, [
    clear,
    hasDesktopBridge,
    hosts,
    isSaving,
    mode,
    onClose,
    onSaved,
    probeAndUpsertRemoteSshConnection,
    rememberSshPassword,
    selectedAlias,
    t,
  ]);
  const handleSubmit = useCallback(() => void handleSave(), [handleSave]);
  // The daemon was just installed: give it a moment to bind, then retry.
  const handleDeployed = useCallback(() => {
    setTimeout(() => void handleSave(), SSH_DEPLOY_RECONNECT_GRACE_MS);
  }, [handleSave]);
  const handleManualTargetChange = useCallback((value: string) => {
    manualTargetRef.current = value;
  }, []);
  const handleDaemonPortChange = useCallback((value: string) => {
    daemonPortRef.current = value;
  }, []);
  const handleDaemonPasswordChange = useCallback((value: string) => {
    daemonPasswordRef.current = value;
  }, []);
  const handleSshPasswordChange = useCallback((value: string) => {
    sshPasswordRef.current = value;
  }, []);

  const errorText = (error: RemoteSshFormError) => t(`pairing.remoteSsh.errors.${error}`);

  let body = null;
  if (mode === "manual") {
    body = (
      <Field
        label={t("pairing.remoteSsh.fields.target")}
        error={
          formError === "targetRequired" || formError === "invalidTarget"
            ? errorText(formError)
            : undefined
        }
        testID="remote-ssh-target"
      >
        <FormTextInput
          ref={manualInputRef}
          size={size}
          testID="remote-ssh-target-input"
          accessibilityLabel={t("pairing.remoteSsh.fields.target")}
          initialValue={manualTargetRef.current}
          onChangeText={handleManualTargetChange}
          placeholder={`ssh://user@host[:port][?daemonPort=${DEFAULT_SSH_DAEMON_PORT}]`}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSaving}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
      </Field>
    );
  } else if (configHosts !== undefined) {
    body = (
      <SshConfigHostPicker
        hosts={configHosts}
        selectedAlias={selectedAlias}
        onSelect={handleSelectAlias}
        daemonPortText={daemonPortRef.current}
        onDaemonPortChange={handleDaemonPortChange}
        size={size}
        disabled={isSaving}
        hostError={formError === "hostRequired" ? errorText(formError) : undefined}
        daemonPortError={formError === "invalidDaemonPort" ? errorText(formError) : undefined}
        onSubmit={handleSubmit}
      />
    );
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="add-remote-ssh-host-modal"
    >
      <Text style={styles.helper}>{t("pairing.remoteSsh.helper")}</Text>
      {hasDesktopBridge ? (
        <SegmentedControl
          options={tabOptions}
          value={mode}
          onValueChange={handleModeChange}
          size={size}
          style={styles.tabs}
          testID="remote-ssh-tabs"
        />
      ) : null}
      {body}
      {connectionError ? (
        <Text style={styles.connectionError} testID="remote-ssh-connection-error">
          {connectionError}
        </Text>
      ) : null}
      <RemoteSshPasswordFields
        failure={failure}
        size={size}
        disabled={isSaving}
        initialSshPassword={sshPasswordRef.current}
        initialDaemonPassword={daemonPasswordRef.current}
        onSshPasswordChange={handleSshPasswordChange}
        onDaemonPasswordChange={handleDaemonPasswordChange}
        rememberSshPassword={rememberSshPassword}
        onRememberSshPasswordChange={setRememberSshPassword}
        onSubmit={handleSubmit}
      />
      {failedTarget ? (
        <RemoteSshDeployOffer
          target={failedTarget}
          enabled={!isSaving}
          onDeployed={handleDeployed}
        />
      ) : null}
      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleCancel}
          disabled={isSaving}
        >
          {t("pairing.remoteSsh.actions.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          onPress={handleSubmit}
          disabled={isSaving}
          leftIcon={ThemedTerminal}
          testID="remote-ssh-submit"
        >
          {isSaving
            ? t("pairing.remoteSsh.actions.connecting")
            : t("pairing.remoteSsh.actions.connect")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
