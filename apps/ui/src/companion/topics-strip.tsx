import type { CompanionNotebookEntry } from "@fde/protocol/messages";
import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getStatusDotColor } from "@/utils/status-dot-color";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface TopicsStripProps {
  topics: readonly CompanionNotebookEntry[];
  /** Navigates to the agent a row refers to; the Companion keeps listening. */
  onOpenAgent: (input: { serverId: string; agentId: string }) => void;
}

/**
 * The notebook, as compact rows. A row is readable at a glance — a status dot,
 * one line, and the agent it refers to — because it competes with the mic orb
 * for attention and must lose.
 */
export function TopicsStrip({ topics, onOpenAgent }: TopicsStripProps) {
  const { t } = useTranslation();

  if (topics.length === 0) {
    return (
      <View style={styles.empty} testID="companion-topics-empty">
        <Text style={styles.emptyText}>{t("companion.topics.empty")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.list} testID="companion-topics">
      {topics.map((topic) => (
        <TopicRow key={topic.id} topic={topic} onOpenAgent={onOpenAgent} />
      ))}
    </View>
  );
}

interface TopicRowProps {
  topic: CompanionNotebookEntry;
  onOpenAgent: (input: { serverId: string; agentId: string }) => void;
}

const TopicRow = memo(function TopicRow({ topic, onOpenAgent }: TopicRowProps) {
  const agent = topic.agent;
  const handlePress = useCallback(() => {
    if (!agent) return;
    onOpenAgent({ serverId: agent.serverId, agentId: agent.agentId });
  }, [agent, onOpenAgent]);

  const row = (
    <>
      <View style={dotStyleFor(topic.state)} />
      <Text style={styles.title} numberOfLines={1}>
        {topic.title}
      </Text>
      {agent ? (
        <View style={styles.chip}>
          <Text style={styles.chipText} numberOfLines={1}>
            {agent.label}
          </Text>
        </View>
      ) : null}
    </>
  );

  if (!agent) {
    return (
      <View style={styles.row} testID={`companion-topic-${topic.id}`}>
        {row}
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={topic.title}
      style={styles.row}
      testID={`companion-topic-${topic.id}`}
    >
      {row}
    </Pressable>
  );
});

function dotStyleFor(state: SidebarStateBucket) {
  if (state === "needs_input") return styles.dotNeedsInput;
  if (state === "failed") return styles.dotFailed;
  if (state === "running") return styles.dotRunning;
  if (state === "attention") return styles.dotAttention;
  return styles.dotDone;
}

const DOT_SIZE = 6;

const styles = StyleSheet.create((theme) => {
  // One bucket-to-colour map for the whole app, baked per variant so each style
  // prop stays a stable object.
  const dot = (bucket: SidebarStateBucket) => ({
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: getStatusDotColor({ theme, bucket, showDoneAsInactive: true }) ?? undefined,
  });

  return {
    list: {
      borderTopWidth: theme.borderWidth[1],
      borderTopColor: theme.colors.border,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingVertical: theme.spacing[2],
    },
    title: {
      flex: 1,
      minWidth: 0,
      fontSize: theme.fontSize.sm,
      color: theme.colors.foreground,
    },
    chip: {
      maxWidth: 140,
      borderRadius: theme.borderRadius.full,
      borderWidth: theme.borderWidth[1],
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface2,
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[0.5],
    },
    chipText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    empty: {
      borderTopWidth: theme.borderWidth[1],
      borderTopColor: theme.colors.border,
      paddingVertical: theme.spacing[3],
    },
    emptyText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.foregroundMuted,
    },
    dotNeedsInput: dot("needs_input"),
    dotFailed: dot("failed"),
    dotRunning: dot("running"),
    dotAttention: dot("attention"),
    dotDone: dot("done"),
  };
});
