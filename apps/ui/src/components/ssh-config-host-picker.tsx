import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { useFetchQuery } from "@/data/query";
import {
  formatSshConfigHostDetails,
  listSshConfigHosts,
  type SshConfigHost,
} from "@/desktop/ssh-config/ssh-config-hosts";
import type { Theme } from "@/styles/theme";

const SSH_CONFIG_HOSTS_QUERY_KEY = ["desktop", "ssh-config-hosts"] as const;
const LIST_MAX_HEIGHT = 5 * 56;

const ThemedCheck = withUnistyles(Check);
const checkIconMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[4],
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
  },
  command: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
  },
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    maxHeight: LIST_MAX_HEIGHT,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  rowHover: {
    backgroundColor: theme.colors.surface2,
  },
  rowSelected: {
    backgroundColor: theme.colors.surface3,
  },
  rowContent: {
    flex: 1,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));

/** The concrete `Host` entries of `~/.ssh/config`, as the shell reports them. */
export function useSshConfigHosts(): SshConfigHost[] | undefined {
  const { data } = useFetchQuery<SshConfigHost[]>({
    queryKey: SSH_CONFIG_HOSTS_QUERY_KEY,
    queryFn: listSshConfigHosts,
    dataShape: "list",
    staleTimeMs: 30_000,
    retry: false,
  });
  return data;
}

export interface SshConfigHostPickerProps {
  hosts: SshConfigHost[];
  selectedAlias: string | null;
  onSelect: (alias: string) => void;
  daemonPortText: string;
  onDaemonPortChange: (value: string) => void;
  size: FieldControlSize;
  disabled?: boolean;
  /** Validation error for the host choice (the daemon port has its own field). */
  hostError?: string;
  daemonPortError?: string;
  onSubmit?: () => void;
}

/**
 * The "SSH config" tab of the Remote SSH sheet: the config hosts as a
 * single-select list, the daemon port, and a reminder that the alias is
 * handed to `ssh` unchanged.
 */
export function SshConfigHostPicker({
  hosts,
  selectedAlias,
  onSelect,
  daemonPortText,
  onDaemonPortChange,
  size,
  disabled = false,
  hostError,
  daemonPortError,
  onSubmit,
}: SshConfigHostPickerProps) {
  const { t } = useTranslation();
  const command = `ssh ${selectedAlias ?? "<alias>"}`;

  return (
    <View style={styles.container}>
      <Text style={styles.helper}>
        {t("pairing.remoteSsh.sshConfig.helperBefore")}
        <Text style={styles.command}>{command}</Text>
        {t("pairing.remoteSsh.sshConfig.helperAfter")}
      </Text>
      <View style={styles.card} testID="remote-ssh-config-host-list">
        {hosts.length === 0 ? (
          <Text style={styles.empty}>{t("pairing.remoteSsh.sshConfig.empty")}</Text>
        ) : (
          <ScrollView>
            {hosts.map((host, index) => (
              <HostRow
                key={host.alias}
                host={host}
                isFirst={index === 0}
                isSelected={host.alias === selectedAlias}
                disabled={disabled}
                onSelect={onSelect}
              />
            ))}
          </ScrollView>
        )}
      </View>
      {hostError ? (
        <Text style={styles.error} testID="remote-ssh-config-host-error">
          {hostError}
        </Text>
      ) : null}
      <Field
        label={t("pairing.remoteSsh.fields.daemonPort")}
        error={daemonPortError}
        testID="remote-ssh-daemon-port"
      >
        <FormTextInput
          size={size}
          testID="remote-ssh-daemon-port-input"
          accessibilityLabel={t("pairing.remoteSsh.fields.daemonPort")}
          initialValue={daemonPortText}
          onChangeText={onDaemonPortChange}
          placeholder="9999"
          keyboardType="number-pad"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
        />
      </Field>
    </View>
  );
}

function HostRow({
  host,
  isFirst,
  isSelected,
  disabled,
  onSelect,
}: {
  host: SshConfigHost;
  isFirst: boolean;
  isSelected: boolean;
  disabled: boolean;
  onSelect: (alias: string) => void;
}) {
  const details = formatSshConfigHostDetails(host);
  const handlePress = useCallback(() => onSelect(host.alias), [host.alias, onSelect]);
  const rowStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      !isFirst && styles.rowBorder,
      Boolean(hovered) && !isSelected && styles.rowHover,
      isSelected && styles.rowSelected,
    ],
    [isFirst, isSelected],
  );
  const accessibilityState = useMemo(
    () => ({ selected: isSelected, disabled }),
    [disabled, isSelected],
  );

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={accessibilityState}
      accessibilityLabel={host.alias}
      disabled={disabled}
      onPress={handlePress}
      style={rowStyle}
      testID={`ssh-config-host-${host.alias}`}
    >
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {host.alias}
        </Text>
        {details ? (
          <Text style={styles.rowHint} numberOfLines={1}>
            {details}
          </Text>
        ) : null}
      </View>
      {isSelected ? <ThemedCheck size={16} uniProps={checkIconMapping} /> : null}
    </Pressable>
  );
}
