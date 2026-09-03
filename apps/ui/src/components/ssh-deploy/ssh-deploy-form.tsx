import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { SshDeployMethod, SshDeployProbe } from "@/desktop/ssh-deploy/ssh-deploy";

const styles = StyleSheet.create((theme) => ({
  container: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[4],
  },
  method: {
    alignSelf: "flex-start",
  },
}));

export interface SshDeployFormProps {
  probe: SshDeployProbe;
  method: SshDeployMethod;
  onMethodChange: (method: SshDeployMethod) => void;
  initialListen: string;
  onListenChange: (value: string) => void;
  initialVersion: string;
  onVersionChange: (value: string) => void;
  disabled: boolean;
}

/** Method, listen address and version for a deploy. Values live in the caller's refs. */
export function SshDeployForm({
  probe,
  method,
  onMethodChange,
  initialListen,
  onListenChange,
  initialVersion,
  onVersionChange,
  disabled,
}: SshDeployFormProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const size = isCompact ? "md" : "sm";
  const methodOptions = useMemo<SegmentedControlOption<SshDeployMethod>[]>(
    () => [
      {
        value: "native",
        label: t("settings.host.sshDeploy.method.native"),
        testID: "ssh-deploy-method-native",
      },
      {
        value: "docker",
        label: t("settings.host.sshDeploy.method.docker"),
        disabled: !probe.hasDocker,
        testID: "ssh-deploy-method-docker",
      },
    ],
    [probe.hasDocker, t],
  );

  return (
    <View style={styles.container}>
      <Field
        label={t("settings.host.sshDeploy.method.label")}
        hint={probe.hasDocker ? undefined : t("settings.host.sshDeploy.method.dockerHint")}
      >
        <SegmentedControl
          options={methodOptions}
          value={method}
          onValueChange={onMethodChange}
          size={size}
          style={styles.method}
          testID="ssh-deploy-method"
        />
      </Field>
      <Field
        label={t("settings.host.sshDeploy.fields.listen")}
        hint={t("settings.host.sshDeploy.fields.listenHint")}
        testID="ssh-deploy-listen"
      >
        <FormTextInput
          size={size}
          accessibilityLabel={t("settings.host.sshDeploy.fields.listen")}
          initialValue={initialListen}
          onChangeText={onListenChange}
          placeholder="127.0.0.1:9999"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          testID="ssh-deploy-listen-input"
        />
      </Field>
      <Field
        label={t("settings.host.sshDeploy.fields.version")}
        hint={t("settings.host.sshDeploy.fields.versionHint")}
        testID="ssh-deploy-version"
      >
        <FormTextInput
          size={size}
          accessibilityLabel={t("settings.host.sshDeploy.fields.version")}
          initialValue={initialVersion}
          onChangeText={onVersionChange}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          testID="ssh-deploy-version-input"
        />
      </Field>
    </View>
  );
}
