import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Terminal } from "lucide-react-native";
import type { SshTransportTarget } from "@fde/protocol/ssh-transport";
import type { HostProfile } from "@/types/host-connection";
import { isElectronRuntime } from "@/desktop/host";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";
import { AdaptiveModalSheet, type SheetHeader } from "./adaptive-modal-sheet";
import { RemoteSshDeployOffer } from "./remote-ssh-deploy-offer";
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
  const [chosenMode, setChosenMode] = useState<RemoteSshMode | null>(null);
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<RemoteSshFormError | null>(null);
  const [connectionError, setConnectionError] = useState("");
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
    setChosenMode(null);
    setSelectedAlias(null);
    setFormError(null);
    setConnectionError("");
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
  }, []);

  const handleSelectAlias = useCallback((alias: string) => {
    setSelectedAlias(alias);
    setFormError(null);
    setConnectionError("");
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

    let result: Awaited<ReturnType<typeof probeAndUpsertRemoteSshConnection>>;
    try {
      setIsSaving(true);
      setFormError(null);
      setConnectionError("");
      setFailedTarget(null);
      result = await probeAndUpsertRemoteSshConnection(resolved.target);
    } catch (error) {
      setConnectionError(
        error instanceof DaemonConnectionTestError
          ? t("pairing.remoteSsh.errors.failedToConnect", { detail: error.message })
          : t("common.errors.unableToSave"),
      );
      if (hasDesktopBridge) setFailedTarget(resolved.target);
      return;
    } finally {
      setIsSaving(false);
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
    selectedAlias,
    t,
  ]);
  const handleSubmit = useCallback(() => void handleSave(), [handleSave]);
  const handleManualTargetChange = useCallback((value: string) => {
    manualTargetRef.current = value;
  }, []);
  const handleDaemonPortChange = useCallback((value: string) => {
    daemonPortRef.current = value;
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
          placeholder="ssh://user@host[:port][?daemonPort=6767]"
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
      {failedTarget ? (
        <RemoteSshDeployOffer target={failedTarget} enabled={!isSaving} onDeployed={handleSubmit} />
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
