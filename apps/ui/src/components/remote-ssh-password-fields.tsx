import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import type { RemoteSshFailure } from "./remote-ssh-failure";

const styles = StyleSheet.create((theme) => ({
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  rememberLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flex: 1,
  },
}));

export interface RemoteSshPasswordFieldsProps {
  /** What the last connect asked for; decides which field shows, if any. */
  failure: RemoteSshFailure | null;
  size: FieldControlSize;
  disabled: boolean;
  initialSshPassword: string;
  initialDaemonPassword: string;
  onSshPasswordChange: (value: string) => void;
  onDaemonPasswordChange: (value: string) => void;
  rememberSshPassword: boolean;
  onRememberSshPasswordChange: (value: boolean) => void;
  onSubmit: () => void;
}

/**
 * The password the failed connect needs: ssh's own (with the in-memory
 * "remember for this session" switch) after `Permission denied` with
 * password auth on offer, or the FDE daemon's after a 4401 from behind the
 * tunnel. Nothing for other failures.
 */
export function RemoteSshPasswordFields({
  failure,
  size,
  disabled,
  initialSshPassword,
  initialDaemonPassword,
  onSshPasswordChange,
  onDaemonPasswordChange,
  rememberSshPassword,
  onRememberSshPasswordChange,
  onSubmit,
}: RemoteSshPasswordFieldsProps) {
  const { t } = useTranslation();
  if (failure?.kind === "ssh-auth") {
    return (
      <>
        <Field
          label={t("pairing.remoteSsh.fields.sshPassword")}
          hint={t("pairing.remoteSsh.hints.sshPassword")}
          testID="remote-ssh-password"
        >
          <FormTextInput
            size={size}
            testID="remote-ssh-password-input"
            accessibilityLabel={t("pairing.remoteSsh.fields.sshPassword")}
            initialValue={initialSshPassword}
            onChangeText={onSshPasswordChange}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />
        </Field>
        <View style={styles.rememberRow}>
          <Text style={styles.rememberLabel}>
            {t("pairing.remoteSsh.fields.rememberSshPassword")}
          </Text>
          <Switch
            value={rememberSshPassword}
            onValueChange={onRememberSshPasswordChange}
            disabled={disabled}
            accessibilityLabel={t("pairing.remoteSsh.fields.rememberSshPassword")}
            testID="remote-ssh-remember-password"
          />
        </View>
      </>
    );
  }
  if (
    failure?.kind === "daemon-password-required" ||
    failure?.kind === "daemon-password-incorrect"
  ) {
    return (
      <Field
        label={t("pairing.remoteSsh.fields.daemonPassword")}
        hint={t("pairing.remoteSsh.hints.daemonPassword")}
        testID="remote-ssh-daemon-password"
      >
        <FormTextInput
          size={size}
          testID="remote-ssh-daemon-password-input"
          accessibilityLabel={t("pairing.remoteSsh.fields.daemonPassword")}
          initialValue={initialDaemonPassword}
          onChangeText={onDaemonPasswordChange}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
        />
      </Field>
    );
  }
  return null;
}
