import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SshDeployCard } from "@/components/ssh-deploy/ssh-deploy-card";
import { isElectronRuntime } from "@/desktop/host";
import type { SshDeployTarget } from "@/desktop/ssh-deploy/ssh-deploy";
import { useSshDeployProbe } from "@/desktop/ssh-deploy/use-ssh-deploy-probe";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import type { HostProfile, RemoteSshHostConnection } from "@/types/host-connection";

function HostSshDeployCard({
  serverId,
  connection,
}: {
  serverId: string;
  connection: RemoteSshHostConnection;
}) {
  const { t } = useTranslation();
  const target = useMemo<SshDeployTarget>(
    () => ({
      host: connection.host,
      ...(connection.sshPort !== undefined ? { sshPort: connection.sshPort } : {}),
    }),
    [connection.host, connection.sshPort],
  );
  const { state, refresh } = useSshDeployProbe(target);
  // A fresh daemon listens on the tunnel's port now; poke the runtime so the
  // host goes online without waiting for the next scheduled probe.
  const handleDeployed = useCallback(() => {
    void getHostRuntimeStore().runProbeCycleNow(serverId);
  }, [serverId]);

  return (
    <SettingsSection
      title={t("settings.host.sshDeploy.title")}
      info={t("settings.host.sshDeploy.info")}
      testID="host-page-ssh-deploy"
    >
      <SshDeployCard
        target={target}
        daemonPort={connection.daemonPort}
        probe={state}
        onRefreshProbe={refresh}
        onDeployed={handleDeployed}
      />
    </SettingsSection>
  );
}

/** The deploy card for a Remote SSH host; nothing outside the desktop shell. */
export function HostSshDeploySection({ host }: { host: HostProfile }) {
  const connection = host.connections.find(
    (entry): entry is RemoteSshHostConnection => entry.type === "remoteSsh",
  );
  if (!isElectronRuntime() || !connection) {
    return null;
  }
  return <HostSshDeployCard serverId={host.serverId} connection={connection} />;
}
