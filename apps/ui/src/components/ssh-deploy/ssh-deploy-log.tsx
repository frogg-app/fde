import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { SshDeployJobState } from "@/desktop/ssh-deploy/use-ssh-deploy-job";

const LOG_MAX_HEIGHT = 240;

const styles = StyleSheet.create((theme) => ({
  container: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  status: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  statusFailed: {
    color: theme.colors.statusDanger,
  },
  scroll: {
    maxHeight: LOG_MAX_HEIGHT,
    backgroundColor: theme.colors.surface2,
  },
  scrollContent: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  line: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.5),
  },
}));

export interface SshDeployLogProps {
  host: string;
  state: SshDeployJobState;
  lines: string[];
  onCancel: () => void;
  testID?: string;
}

/** Monospace, auto-scrolling output of the running or last deploy job. */
export function SshDeployLog({ host, state, lines, onCancel, testID }: SshDeployLogProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  const handleContentSizeChange = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  if (state.status === "idle") {
    return null;
  }

  let statusText: string;
  let failed = false;
  if (state.status === "running") {
    statusText = t("settings.host.sshDeploy.log.running", { host });
  } else if (state.status === "done") {
    statusText = t("settings.host.sshDeploy.log.done");
  } else if (state.cancelled) {
    statusText = t("settings.host.sshDeploy.log.cancelled");
  } else {
    statusText = t("settings.host.sshDeploy.log.failed", { detail: state.detail });
    failed = true;
  }

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.header}>
        <Text style={[styles.status, failed ? styles.statusFailed : null]}>{statusText}</Text>
        {state.status === "running" ? (
          <Button variant="outline" size="sm" onPress={onCancel} disabled={state.jobId === null}>
            {t("settings.host.sshDeploy.actions.cancel")}
          </Button>
        ) : null}
      </View>
      {lines.length > 0 ? (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={handleContentSizeChange}
        >
          {lines.map((line, index) => (
            // Lines are append-only for the life of a job, so the index is stable.
            // oxlint-disable-next-line react/no-array-index-key
            <Text key={index} style={styles.line} selectable>
              {line || " "}
            </Text>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
