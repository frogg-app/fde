import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMutation } from "@tanstack/react-query";
import type { AgentProviderDefinition } from "@fde/protocol/messages";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { resolvePreferredEditorId, usePreferredEditor } from "@/hooks/use-preferred-editor";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";

// Provider brand names are not translated.
const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  copilot: "GitHub Copilot",
};

function dirname(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return index > 0 ? filePath.slice(0, index) : filePath;
}

export function useProviderAgentDefinitions(serverId: string, cwd?: string | null) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "providerAgentDefinitions");
  const projectRoot = cwd?.trim() || null;
  const query = useFetchQuery<AgentProviderDefinition[], Error>({
    queryKey: ["host", serverId, "provider-agent-definitions", projectRoot],
    queryFn: async () => {
      if (!client) throw new Error("not connected");
      const payload = await client.listProviderAgentDefinitions(
        projectRoot ? { cwd: projectRoot } : {},
      );
      if (payload.error) throw new Error(payload.error);
      return payload.definitions;
    },
    enabled: supported && connected && client !== null,
    retry: false,
    dataShape: "value",
    staleTimeMs: 0,
  });
  return { query, supported, connected };
}

function useOpenDefinition(serverId: string) {
  const { t } = useTranslation();
  const toast = useToast();
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const { targets, isAvailable } = useDesktopOpenTargets({
    isLocalExecution: isLocalDaemon,
  });
  const { preferredEditorId } = usePreferredEditor();
  const editorIds = useMemo(
    () => targets.filter((target) => target.kind === "editor").map((target) => target.id),
    [targets],
  );
  const editorId = isAvailable
    ? resolvePreferredEditorId(editorIds, preferredEditorId ?? null)
    : null;
  const open = useMutation({
    mutationFn: (filePath: string) => {
      if (!editorId) throw new Error(t("workspace.git.openInEditor.failedOpen"));
      return openDesktopTarget({
        editorId,
        workspacePath: dirname(filePath),
        filePath,
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return { canOpen: editorId !== null, open };
}

export function ProviderAgentDefinitionsSection({
  serverId,
  cwd,
}: {
  serverId: string;
  cwd?: string | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isProject = Boolean(cwd?.trim());
  const { query, supported, connected } = useProviderAgentDefinitions(serverId, cwd);
  const { canOpen, open } = useOpenDefinition(serverId);
  const refetch = query.refetch;
  const handleRetry = useCallback(() => void refetch(), [refetch]);
  const handleCopy = useCallback(
    (filePath: string) => {
      void copyToClipboard(filePath)
        .then(() => toast.copied(t("settings.host.agentDefinitions.copyPath")))
        .catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error)),
        );
    },
    [t, toast],
  );

  const title = isProject
    ? t("settings.host.agentDefinitions.projectTitle")
    : t("settings.host.agentDefinitions.title");
  const info = isProject
    ? t("settings.host.agentDefinitions.projectDescription")
    : t("settings.host.agentDefinitions.description");

  let body;
  if (!connected) {
    body = <Text style={styles.message}>{t("settings.host.agents.unavailable")}</Text>;
  } else if (!supported) {
    body = <Text style={styles.message}>{t("settings.host.agentDefinitions.unsupported")}</Text>;
  } else if (query.isPending) {
    body = (
      <View style={styles.message}>
        <LoadingSpinner size="small" color={styles.provider.color} />
      </View>
    );
  } else if (query.isError) {
    body = (
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.agentDefinitions.loadFailed")}
          </Text>
          <Text style={settingsStyles.rowError}>{query.error.message}</Text>
        </View>
        <Button size="sm" variant="outline" onPress={handleRetry}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  } else if (query.data.length === 0) {
    body = <Text style={styles.message}>{t("settings.host.agentDefinitions.empty")}</Text>;
  } else {
    body = query.data.map((definition, index) => (
      <DefinitionRow
        key={definition.path}
        definition={definition}
        isFirst={index === 0}
        canOpen={canOpen}
        isOpening={open.isPending && open.variables === definition.path}
        onOpen={open.mutate}
        onCopy={handleCopy}
      />
    ));
  }

  return (
    <SettingsSection title={title} info={info}>
      <View style={settingsStyles.card}>{body}</View>
    </SettingsSection>
  );
}

interface DefinitionRowProps {
  definition: AgentProviderDefinition;
  isFirst: boolean;
  canOpen: boolean;
  isOpening: boolean;
  onOpen: (filePath: string) => void;
  onCopy: (filePath: string) => void;
}

function DefinitionRow({
  definition,
  isFirst,
  canOpen,
  isOpening,
  onOpen,
  onCopy,
}: DefinitionRowProps) {
  const { t } = useTranslation();
  const handleOpen = useCallback(() => onOpen(definition.path), [definition.path, onOpen]);
  const handleCopy = useCallback(() => onCopy(definition.path), [definition.path, onCopy]);
  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder],
    [isFirst],
  );
  return (
    <View style={rowStyle} testID="provider-agent-definition-row">
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {definition.name}
          <Text style={styles.provider}>
            {"  "}
            {PROVIDER_LABELS[definition.provider] ?? definition.provider}
          </Text>
        </Text>
        {definition.description ? (
          <Text style={settingsStyles.rowHint} numberOfLines={2}>
            {definition.description}
          </Text>
        ) : null}
        <Text style={styles.path} numberOfLines={1} selectable>
          {definition.path}
        </Text>
      </View>
      <View style={styles.actions}>
        {canOpen ? (
          <Button size="sm" variant="outline" loading={isOpening} onPress={handleOpen}>
            {t("settings.host.agentDefinitions.open")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onPress={handleCopy}>
          {t("settings.host.agentDefinitions.copyPath")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
  },
  provider: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  path: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    marginTop: theme.spacing[1],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
