import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { useFetchQuery } from "@/data/query";
import {
  buildSshConfigHostTarget,
  formatSshConfigHostDetails,
  listSshConfigHosts,
  type SshConfigHost,
} from "@/desktop/ssh-config/ssh-config-hosts";

const SSH_CONFIG_HOSTS_QUERY_KEY = ["desktop", "ssh-config-hosts"] as const;

export interface SshConfigHostPickerProps {
  size: FieldControlSize;
  disabled?: boolean;
  onSelect: (target: string) => void;
}

/**
 * "From SSH config": the concrete `Host` entries of `~/.ssh/config`, offered
 * as one-click targets for the Remote SSH form. Renders nothing until the
 * shell reports at least one host.
 */
export function SshConfigHostPicker({
  size,
  disabled = false,
  onSelect,
}: SshConfigHostPickerProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDisplay, setSelectedDisplay] = useState<SelectFieldDisplay | null>(null);
  const { data: hosts } = useFetchQuery<SshConfigHost[]>({
    queryKey: SSH_CONFIG_HOSTS_QUERY_KEY,
    queryFn: listSshConfigHosts,
    dataShape: "list",
    staleTimeMs: 30_000,
    retry: false,
  });

  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      (hosts ?? []).map((host) => ({
        id: host.alias,
        value: host.alias,
        label: host.alias,
        description: formatSshConfigHostDetails(host) || undefined,
        testID: `ssh-config-host-${host.alias}`,
      })),
    [hosts],
  );

  const handleChange = useCallback(
    (alias: string, display: SelectFieldDisplay) => {
      setSelected(alias);
      setSelectedDisplay(display);
      onSelect(buildSshConfigHostTarget({ alias }));
    },
    [onSelect],
  );

  if (options.length === 0) {
    return null;
  }

  return (
    <SelectField
      label={t("pairing.remoteSsh.sshConfig.label")}
      value={selected}
      selectedDisplay={selectedDisplay}
      options={options}
      onChange={handleChange}
      placeholder={t("pairing.remoteSsh.sshConfig.placeholder")}
      emptyText={t("pairing.remoteSsh.sshConfig.empty")}
      searchable={options.length > 6}
      searchPlaceholder={t("pairing.remoteSsh.sshConfig.searchPlaceholder")}
      title={t("pairing.remoteSsh.sshConfig.label")}
      size={size}
      disabled={disabled}
      testID="remote-ssh-config-host"
      triggerTestID="remote-ssh-config-host-trigger"
    />
  );
}
