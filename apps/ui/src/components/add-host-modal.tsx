import { useCallback, useMemo, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { DEFAULT_DAEMON_PORT } from "@/constants/daemon-port";
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, Link2 } from "lucide-react-native";
import type { HostProfile } from "@/types/host-connection";
import { useHosts, useHostMutations } from "@/runtime/host-runtime";
import {
  describeDirectEndpointInput,
  parseDirectEndpointInput,
  previewDirectEndpointInput,
  type DirectEndpointInput,
} from "@/utils/direct-endpoint-input";
import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { formatConnectionFailureMessage } from "./add-host-connection-errors";
import { NetworkServersList, type NetworkServerConnectedResult } from "./network-servers-list";
import { useDirectConnectionErrorLabels } from "./use-direct-connection-error-labels";

const FLEX_ONE_STYLE = { flex: 1 } as const;
const DEFAULT_PORT_TEXT = String(DEFAULT_DAEMON_PORT);
const ADVANCED_PLACEHOLDER = `192.168.1.10:${DEFAULT_DAEMON_PORT}`;

interface DirectConnectionDraft {
  host: string;
  port: string;
  useTls: boolean;
  password: string;
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  portRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  hostField: {
    flex: 1,
    minWidth: 0,
  },
  portField: {
    width: 112,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  passwordInput: {
    flex: 1,
    minWidth: 0,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1],
  },
  advancedText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  resolvedUrl: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
  },
  networkSection: {
    marginTop: theme.spacing[4],
  },
}));

/**
 * The host field takes a bare host, `host:port`, or any full address form the
 * advanced field accepts; a full address wins over the separate port/SSL
 * controls so a pasted `https://…` URL just works.
 */
function endpointFromDraft(draft: DirectConnectionDraft): DirectEndpointInput {
  const host = draft.host.trim();
  const hasScheme = host.includes("://");
  const hasInlinePort = /:\d+\/?$/.test(host) || host.startsWith("[");
  if (hasScheme || hasInlinePort) {
    const parsed = parseDirectEndpointInput(host);
    return {
      ...parsed,
      useTls: parsed.useTls || draft.useTls,
      ...(draft.password ? { password: draft.password } : {}),
    };
  }
  const portText = draft.port.trim() || DEFAULT_PORT_TEXT;
  const parsed = parseDirectEndpointInput(`${host}:${portText}`);
  return {
    ...parsed,
    useTls: draft.useTls,
    ...(draft.password ? { password: draft.password } : {}),
  };
}

function draftFromEndpoint(parsed: DirectEndpointInput): DirectConnectionDraft {
  return {
    host: parsed.host,
    port: String(parsed.port),
    useTls: parsed.useTls,
    password: parsed.password ?? "",
  };
}

export interface AddHostModalProps {
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

export function AddHostModal({ visible, onClose, onCancel, onSaved }: AddHostModalProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const daemons = useHosts();
  const { probeAndUpsertDirectConnection } = useHostMutations();
  const isMobile = useIsCompactFormFactor();
  const errorLabels = useDirectConnectionErrorLabels();

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(DEFAULT_PORT_TEXT);
  const [useTls, setUseTls] = useState(false);
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [advancedUri, setAdvancedUri] = useState("");
  const [inputResetKey, bumpInputResetKey] = useReducer((key: number) => key + 1, 0);

  const clearInput = useCallback(() => {
    setHost("");
    setPort(DEFAULT_PORT_TEXT);
    setUseTls(false);
    setPassword("");
    setIsPasswordVisible(false);
    setIsAdvancedOpen(false);
    setAdvancedUri("");
    bumpInputResetKey();
  }, []);

  const connectIcon = useMemo(
    () => <Link2 size={16} color={theme.colors.accentForeground} />,
    [theme.colors.accentForeground],
  );
  const hostFieldStyle = useMemo(() => [styles.field, styles.hostField], []);
  const portFieldStyle = useMemo(() => [styles.field, styles.portField], []);
  const checkboxStyle = useMemo(
    () => [styles.checkbox, useTls ? styles.checkboxChecked : null],
    [useTls],
  );
  const passwordInputStyle = useMemo(() => [styles.input, styles.passwordInput], []);
  const useTlsAccessibilityState = useMemo(
    () => ({ checked: useTls, disabled: isSaving }),
    [isSaving, useTls],
  );
  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.direct.title") }), [t]);
  const resolvedAdvancedUrl = useMemo(() => previewDirectEndpointInput(advancedUri), [advancedUri]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    onClose();
  }, [isSaving, clearInput, onClose]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    (onCancel ?? onClose)();
  }, [isSaving, clearInput, onCancel, onClose]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;

    let target: ReturnType<typeof describeDirectEndpointInput> & { input: DirectEndpointInput };
    try {
      const input = isAdvancedOpen
        ? parseDirectEndpointInput(advancedUri)
        : endpointFromDraft({ host, port, useTls, password });
      target = { ...describeDirectEndpointInput(input), input };
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("pairing.direct.errors.invalidConnection"),
      );
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage("");

      const { profile, serverId, hostname } = await probeAndUpsertDirectConnection({
        endpoint: target.endpoint,
        useTls: target.input.useTls,
        ...(target.input.password ? { password: target.input.password } : {}),
      });
      const isNewHost = !daemons.some((daemon) => daemon.serverId === serverId);

      onSaved?.({ profile, serverId, hostname, isNewHost });
      handleClose();
    } catch (error) {
      const combined = formatConnectionFailureMessage({
        endpoint: target.webSocketUrl,
        error,
        labels: errorLabels,
        detailsLabel: (detail) => t("pairing.direct.errors.details", { detail }),
      });
      setErrorMessage(combined);
      if (!isMobile) {
        Alert.alert(t("pairing.direct.errors.failedTitle"), combined);
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    advancedUri,
    daemons,
    errorLabels,
    handleClose,
    host,
    isAdvancedOpen,
    isMobile,
    isSaving,
    onSaved,
    password,
    port,
    probeAndUpsertDirectConnection,
    t,
    useTls,
  ]);

  const handleSubmitEditing = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleNetworkServerConnected = useCallback(
    (result: NetworkServerConnectedResult) => {
      onSaved?.(result);
      handleClose();
    },
    [handleClose, onSaved],
  );

  const handleToggleUseTls = useCallback(() => {
    if (isSaving) return;
    setUseTls((current) => !current);
  }, [isSaving]);

  const handleTogglePasswordVisibility = useCallback(() => {
    setIsPasswordVisible((current) => !current);
  }, []);

  const handleToggleAdvanced = useCallback(() => {
    if (!isAdvancedOpen) {
      try {
        setAdvancedUri(
          describeDirectEndpointInput(endpointFromDraft({ host, port, useTls, password }))
            .storageUri,
        );
      } catch {
        setAdvancedUri("");
      }
      setErrorMessage("");
      setIsAdvancedOpen(true);
      return;
    }

    try {
      const next = draftFromEndpoint(parseDirectEndpointInput(advancedUri));
      setHost(next.host);
      setPort(next.port);
      setUseTls(next.useTls);
      setPassword(next.password);
      bumpInputResetKey();
    } catch {
      // Keep whatever the plain fields already held.
    }
    setErrorMessage("");
    setIsAdvancedOpen(false);
  }, [advancedUri, host, isAdvancedOpen, password, port, useTls]);

  const AdvancedIcon = isAdvancedOpen ? ChevronDown : ChevronRight;
  const PasswordIcon = isPasswordVisible ? EyeOff : Eye;

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="add-host-modal"
    >
      <Text style={styles.helper}>{t("pairing.direct.helper")}</Text>

      <View style={styles.portRow}>
        <View style={hostFieldStyle}>
          <Text style={styles.label}>{t("pairing.direct.fields.host")}</Text>
          <AdaptiveTextInput
            testID="direct-host-input"
            nativeID="direct-host-input"
            accessibilityLabel={t("pairing.direct.fields.host")}
            initialValue={host}
            resetKey={`direct-host-${inputResetKey}`}
            onChangeText={setHost}
            placeholder="192.168.1.10"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!isSaving}
            returnKeyType="next"
          />
        </View>
        <View style={portFieldStyle}>
          <Text style={styles.label}>{t("pairing.direct.fields.port")}</Text>
          <AdaptiveTextInput
            testID="direct-port-input"
            nativeID="direct-port-input"
            accessibilityLabel={t("pairing.direct.fields.port")}
            initialValue={port}
            resetKey={`direct-port-${inputResetKey}`}
            onChangeText={setPort}
            placeholder={DEFAULT_PORT_TEXT}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            editable={!isSaving}
            returnKeyType="done"
            onSubmitEditing={handleSubmitEditing}
          />
        </View>
      </View>

      <Pressable
        style={styles.checkboxRow}
        onPress={handleToggleUseTls}
        disabled={isSaving}
        accessibilityRole="checkbox"
        accessibilityLabel={t("pairing.direct.fields.useSsl")}
        accessibilityState={useTlsAccessibilityState}
        testID="direct-ssl-toggle"
      >
        <View style={checkboxStyle}>
          {useTls ? (
            <View testID="direct-ssl-toggle-checked">
              <Check size={14} color={theme.colors.accentForeground} />
            </View>
          ) : null}
        </View>
        <Text style={styles.label}>{t("pairing.direct.fields.useSsl")}</Text>
      </Pressable>

      <View style={styles.field}>
        <Text style={styles.label}>{t("pairing.direct.fields.password")}</Text>
        <View style={styles.passwordRow}>
          <AdaptiveTextInput
            testID="direct-password-input"
            nativeID="direct-password-input"
            accessibilityLabel={t("pairing.direct.fields.password")}
            initialValue={password}
            resetKey={`direct-password-${inputResetKey}`}
            onChangeText={setPassword}
            placeholder={t("pairing.direct.fields.optional")}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={passwordInputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!isPasswordVisible}
            editable={!isSaving}
            returnKeyType="done"
            onSubmitEditing={handleSubmitEditing}
          />
          <Pressable
            style={styles.iconButton}
            onPress={handleTogglePasswordVisibility}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel={
              isPasswordVisible
                ? t("pairing.direct.passwordVisibility.hide")
                : t("pairing.direct.passwordVisibility.show")
            }
            testID="direct-password-visibility-toggle"
          >
            <PasswordIcon size={18} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <Pressable
          style={styles.advancedToggle}
          onPress={handleToggleAdvanced}
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityLabel={
            isAdvancedOpen ? t("pairing.direct.advanced.hide") : t("pairing.direct.advanced.show")
          }
          testID="direct-host-advanced-toggle"
        >
          <AdvancedIcon size={16} color={theme.colors.foregroundMuted} />
          <Text style={styles.advancedText}>{t("pairing.direct.advanced.label")}</Text>
        </Pressable>
        {isAdvancedOpen ? (
          <>
            <AdaptiveTextInput
              testID="direct-host-uri-input"
              nativeID="direct-host-uri-input"
              accessibilityLabel={t("pairing.direct.fields.connectionUri")}
              initialValue={advancedUri}
              resetKey={`direct-host-uri-${inputResetKey}`}
              onChangeText={setAdvancedUri}
              placeholder={ADVANCED_PLACEHOLDER}
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!isSaving}
              returnKeyType="done"
              onSubmitEditing={handleSubmitEditing}
            />
            <Text style={styles.helper}>
              {t("pairing.direct.advanced.helper", { port: DEFAULT_DAEMON_PORT })}
            </Text>
            {resolvedAdvancedUrl ? (
              <Text style={styles.helper} testID="direct-host-uri-resolved">
                {t("pairing.direct.advanced.resolved")}{" "}
                <Text style={styles.resolvedUrl}>{resolvedAdvancedUrl}</Text>
              </Text>
            ) : null}
          </>
        ) : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleCancel}
          disabled={isSaving}
        >
          {t("pairing.direct.actions.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          variant="default"
          onPress={handleSavePress}
          disabled={isSaving}
          leftIcon={connectIcon}
          testID="direct-host-submit"
        >
          {isSaving ? t("pairing.direct.actions.connecting") : t("pairing.direct.actions.connect")}
        </Button>
      </View>

      {visible ? (
        <View style={styles.networkSection}>
          <NetworkServersList onConnected={handleNetworkServerConnected} />
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}
