import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SshTransportTarget } from "@fde/protocol/ssh-transport";
import { SshDeployCard } from "@/components/ssh-deploy/ssh-deploy-card";
import { Alert } from "@/components/ui/alert";
import type { SshDeployTarget } from "@/desktop/ssh-deploy/ssh-deploy";
import { useSshDeployProbe } from "@/desktop/ssh-deploy/use-ssh-deploy-probe";

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
  },
}));

export interface RemoteSshDeployOfferProps {
  target: SshTransportTarget;
  /** The connection failed; run the probe now. */
  enabled: boolean;
  /** A deploy finished: retry the connection. */
  onDeployed: () => void;
}

/**
 * Shown under a failed Remote SSH connect: if ssh itself works and the host
 * has no FDE daemon, offers to deploy one right here. Silent while probing,
 * when the probe fails (the ssh error is already on screen), and when a
 * daemon is installed (the failure is something else).
 */
export function RemoteSshDeployOffer({ target, enabled, onDeployed }: RemoteSshDeployOfferProps) {
  const { t } = useTranslation();
  const deployTarget = useMemo<SshDeployTarget>(
    () => ({
      host: target.host,
      ...(target.sshPort !== undefined ? { sshPort: target.sshPort } : {}),
    }),
    [target.host, target.sshPort],
  );
  const { state, refresh } = useSshDeployProbe(deployTarget, enabled);
  if (
    !enabled ||
    state.status !== "ready" ||
    state.probe.hasFde.installed ||
    state.probe.hasDockerContainer
  ) {
    return null;
  }

  return (
    <View style={styles.container} testID="remote-ssh-deploy-offer">
      <Alert
        variant="info"
        title={t("settings.host.sshDeploy.offer.title")}
        description={t("settings.host.sshDeploy.offer.message", { host: target.host })}
      />
      <SshDeployCard
        target={deployTarget}
        daemonPort={target.daemonPort}
        probe={state}
        onRefreshProbe={refresh}
        onDeployed={onDeployed}
        testID="remote-ssh-deploy-card"
      />
    </View>
  );
}
