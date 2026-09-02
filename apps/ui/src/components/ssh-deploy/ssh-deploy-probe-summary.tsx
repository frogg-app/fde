import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  describeSshDeployPlatform,
  sshDeployServiceKind,
  type SshDeployProbe,
} from "@/desktop/ssh-deploy/ssh-deploy";
import { settingsStyles } from "@/styles/settings";

const styles = StyleSheet.create((theme) => ({
  rows: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  label: {
    width: 88,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  value: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
}));

/** What the probe found: platform, service manager, Docker, and blockers. */
export function SshDeployProbeSummary({ probe }: { probe: SshDeployProbe }) {
  const { t } = useTranslation();
  const service = sshDeployServiceKind(probe);
  const platform = describeSshDeployPlatform(probe) || t("settings.host.sshDeploy.probe.unknown");
  const serviceText = t(`settings.host.sshDeploy.probe.service.${service}`);
  let dockerText = t("settings.host.sshDeploy.probe.docker.missing");
  if (probe.hasDocker) {
    dockerText = probe.hasDockerContainer
      ? t("settings.host.sshDeploy.probe.docker.container")
      : t("settings.host.sshDeploy.probe.docker.available");
  }

  return (
    <View style={styles.rows} testID="ssh-deploy-probe-summary">
      <View style={styles.row}>
        <Text style={styles.label}>{t("settings.host.sshDeploy.probe.platform")}</Text>
        <Text style={styles.value}>
          {platform} · {serviceText}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{t("settings.host.sshDeploy.probe.docker.label")}</Text>
        <Text style={styles.value}>{dockerText}</Text>
      </View>
      {probe.hasCurl ? null : (
        <Text style={styles.warning}>{t("settings.host.sshDeploy.probe.curlMissing")}</Text>
      )}
      {service === "none" ? (
        <Text style={styles.warning}>{t("settings.host.sshDeploy.probe.noService")}</Text>
      ) : null}
      {probe.homeDir ? (
        <Text style={settingsStyles.rowHint}>
          {t("settings.host.sshDeploy.probe.installDir", { home: probe.homeDir })}
        </Text>
      ) : null}
    </View>
  );
}
