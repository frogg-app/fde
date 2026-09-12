import { Mic, MicOff, SendHorizontal, Square } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { useSettings } from "@/hooks/use-settings";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildCompanionTopicRows } from "./topic-rows";
import { MicOrb } from "./mic-orb";
import { getCompanionRuntime, getCompanionSession } from "./session-registry";
import {
  deriveCompanionMicState,
  useCompanionStore,
  type CompanionSession,
  type CompanionMicState,
} from "./store";
import { TopicsStrip } from "./topics-strip";
import { useCompanionHost } from "./use-companion-host";

const ThemedMic = withUnistyles(Mic, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedMicOff = withUnistyles(MicOff, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedSquare = withUnistyles(Square, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedSend = withUnistyles(SendHorizontal, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const muteIcon = <ThemedMic size={16} />;
const unmuteIcon = <ThemedMicOff size={16} />;
const stopIcon = <ThemedSquare size={16} />;
const sendIcon = <ThemedSend size={16} />;

/**
 * The Companion surface. Mounted once in the app container's singleton block —
 * it is global, so it is neither a route nor a fourth mobile panel
 * (docs/mobile-panels.md). Compact gets the bottom sheet, desktop the centred
 * card; `AdaptiveModalSheet` owns that split.
 */
export function CompanionHost() {
  const { t } = useTranslation();
  const enabled = useSettings((settings) => settings.companionEnabled);
  const isMinimized = useCompanionStore((state) => state.isMinimized);
  const session = useCompanionStore((state) => state.session);
  const open = useCompanionStore((state) => state.open);
  const isOpen = useCompanionStore((state) => state.isOpen);
  const close = useCompanionStore((state) => state.close);
  const host = useCompanionHost();
  const context = useCompanionStore((state) => state.context);
  const hostLabel = useSessionStore((state) =>
    host.serverId ? state.sessions[host.serverId]?.serverInfo?.hostname : null,
  );
  const workspace = useSessionStore((state) =>
    context?.workspaceId
      ? state.sessions[context.serverId]?.workspaces.get(context.workspaceId)
      : undefined,
  );
  const workspaceLabel = workspace
    ? `${workspace.projectCustomName ?? workspace.projectDisplayName} · ${workspace.name}`
    : null;
  const contextLabel = [hostLabel ?? host.serverId, workspaceLabel].filter(Boolean).join(" · ");
  const header = useMemo<SheetHeader>(
    () => ({ title: t("companion.title"), subtitle: contextLabel }),
    [t, contextLabel],
  );

  useEffect(() => {
    if (!enabled) {
      void getCompanionRuntime().stop();
    }
    if (!enabled && isOpen) close();
  }, [enabled, isOpen, isMinimized, close]);

  useEffect(
    () => () => {
      void getCompanionRuntime().stop();
    },
    [],
  );

  const end = useCallback(() => {
    close();
    void getCompanionRuntime().stop();
  }, [close]);
  if (!enabled) return null;
  return (
    <>
      {isMinimized && ["open", "starting", "reconnecting"].includes(session.status) ? (
        <View style={styles.activeIndicator} testID="companion-active-indicator">
          <Button size="sm" onPress={open}>
            {session.status === "reconnecting"
              ? t("agentPanel.states.reconnecting")
              : t("companion.actions.resume")}
          </Button>
          <Text style={styles.activeContext} numberOfLines={1}>
            {contextLabel}
          </Text>
          <Button size="sm" variant="ghost" onPress={end}>
            {t("companion.actions.stop")}
          </Button>
        </View>
      ) : null}
      <AdaptiveModalSheet
        header={header}
        visible={isOpen}
        onClose={close}
        testID="companion-sheet"
        closeButtonTestID="companion-close"
      >
        {isOpen ? (
          <CompanionBody
            serverId={host.serverId}
            unavailableReason={
              host.details && host.details.conversationControls !== true
                ? t("companion.reason.companion_update_required")
                : host.unavailableReason
            }
            isAvailable={host.isAvailable}
          />
        ) : null}
      </AdaptiveModalSheet>
    </>
  );
}

interface CompanionBodyProps {
  serverId: string | null;
  isAvailable: boolean;
  unavailableReason: string | null;
}

function CompanionBody({ serverId, isAvailable, unavailableReason }: CompanionBodyProps) {
  const { t } = useTranslation();
  const session = useCompanionStore((state) => state.session);
  const isMuted = useCompanionStore((state) => state.isMuted);
  const volume = useCompanionStore((state) => state.volume);
  const speakingVolume = useCompanionStore((state) => state.speakingVolume);
  const isThinking = useCompanionStore((state) => state.isThinking);
  const isSpeaking = useCompanionStore((state) => state.isSpeaking);
  const partialTranscript = useCompanionStore((state) => state.partialTranscript);
  const finalTranscript = useCompanionStore((state) => state.finalTranscript);
  const reply = useCompanionStore((state) => state.reply);
  const notebookEntries = useCompanionStore((state) => state.topics);
  const hostSession = useSessionStore((state) => (serverId ? state.sessions[serverId] : undefined));
  // The strip's owner resolves every row once, so no row runs its own selector.
  const topics = useMemo(
    () => buildCompanionTopicRows({ entries: notebookEntries, serverId, session: hostSession }),
    [notebookEntries, serverId, hostSession],
  );
  const send = useCompanionStore((state) => state.send);
  const minimize = useCompanionStore((state) => state.minimize);
  const sessionStarting = useCompanionStore((state) => state.sessionStarting);
  const sessionStopping = useCompanionStore((state) => state.sessionStopping);
  const dismissSessionError = useCompanionStore((state) => state.dismissSessionError);
  const dismissSendError = useCompanionStore((state) => state.dismissSendError);

  const { settings } = useSettings();
  const activeWorkspace = useActiveWorkspaceSelection();
  const [draft, setDraft] = useState("");
  // The input is uncontrolled, so clearing it after a send means remounting the
  // value rather than writing an empty string back through the prop.
  const [draftResetKey, setDraftResetKey] = useState(0);
  const micState = deriveCompanionMicState({ session, isMuted, isSpeaking, isThinking });
  const isReconnecting = session.status === "reconnecting";
  const isBusy = ["starting", "stopping", "reconnecting"].includes(session.status);
  const canStop = ["open", "starting", "reconnecting"].includes(session.status);
  const isSessionOpen = session.status === "open";

  const start = useCallback(() => {
    if (!serverId) return;
    const adapter = getCompanionSession(serverId);
    if (!adapter) return;
    const context = useCompanionStore.getState().context ?? {
      serverId,
      workspaceId: activeWorkspace?.serverId === serverId ? activeWorkspace.workspaceId : undefined,
    };
    useCompanionStore.getState().launch(context);
    sessionStarting(serverId);
    void getCompanionRuntime().start(adapter, settings.companionNativeVoice, {
      workspaceId: context.workspaceId,
      agentId: "agentId" in context ? context.agentId : undefined,
      verbosity: settings.companionVerbosity,
      updates: settings.companionUpdates,
      acknowledgeTasks: settings.companionAcknowledgeTasks,
      pauseMs: settings.companionPauseMs,
      interruptible: settings.companionInterruptible,
    });
  }, [serverId, sessionStarting, settings, activeWorkspace]);

  const stop = useCallback(() => {
    sessionStopping();
    void getCompanionRuntime().stop();
  }, [sessionStopping]);

  const startRequested = useRef(false);
  // Opening is a user action. A stopped session must not restart on status changes.
  useEffect(() => {
    if (startRequested.current) return;
    startRequested.current = true;
    if (isAvailable && useCompanionStore.getState().session.status === "closed") start();
  }, [isAvailable, start]);

  const toggleMute = useCallback(() => getCompanionRuntime().toggleMute(), []);
  const pressOrb = useCallback(() => {
    if (isSessionOpen) toggleMute();
    else if (!isBusy) start();
  }, [isSessionOpen, isBusy, toggleMute, start]);

  const submitDraft = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
    setDraftResetKey((key) => key + 1);
    void getCompanionRuntime().sendMessage(text);
  }, [draft]);

  const retrySend = useCallback(() => {
    if (send.status !== "failed") return;
    void getCompanionRuntime().sendMessage(send.text);
  }, [send]);

  // Tapping a topic navigates but deliberately does not close the sheet or the
  // session: the Companion keeps listening while you look.
  const openAgent = useCallback((input: { serverId: string; agentId: string }) => {
    navigateToAgent(input);
  }, []);

  if (!isAvailable && !isReconnecting) {
    return (
      <Alert
        variant="warning"
        title={t("companion.unavailable.title")}
        description={unavailableReason ?? t("companion.unavailable.description")}
        testID="companion-unavailable"
      />
    );
  }

  return (
    <View style={styles.body}>
      <View style={styles.orbRow}>
        <MicOrb
          state={micState}
          volume={volume}
          speakingVolume={speakingVolume}
          accessibilityLabel={t(`companion.micState.${micState}`)}
          onPress={pressOrb}
          testID="companion-mic-orb"
        />
        <Text style={styles.micStateLabel} testID="companion-mic-state">
          {t(companionStatusLabel(session.status, micState))}
        </Text>
      </View>

      {session.status === "failed" ? (
        <Alert
          variant="error"
          title={t("companion.error.startFailed")}
          description={t(`companion.reason.${session.reasonCode ?? "unknown"}`, {
            defaultValue: t("companion.reason.unknown"),
          })}
          testID="companion-session-error"
        >
          <View style={styles.alertActions}>
            {session.retryable ? (
              <Button size="sm" variant="secondary" onPress={start} testID="companion-retry-start">
                {t("common.actions.retry")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onPress={dismissSessionError}
              testID="companion-dismiss-error"
            >
              {t("common.actions.dismiss")}
            </Button>
          </View>
        </Alert>
      ) : null}

      <Transcript partial={partialTranscript} final={finalTranscript} />

      {settings.companionShowReplyText && reply.length > 0 ? (
        <Text style={styles.reply} testID="companion-reply">
          {reply}
        </Text>
      ) : null}

      <View style={styles.controls}>
        <Button size="sm" variant="ghost" disabled={!isSessionOpen} onPress={minimize}>
          {t("companion.actions.minimize")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={isMuted ? unmuteIcon : muteIcon}
          onPress={toggleMute}
          disabled={!isSessionOpen}
          testID="companion-mute"
        >
          {isMuted ? t("companion.actions.unmute") : t("companion.actions.mute")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={stopIcon}
          onPress={stop}
          disabled={!canStop}
          loading={session.status === "stopping"}
          testID="companion-stop"
        >
          {t("companion.actions.stop")}
        </Button>
      </View>

      {!settings.companionNativeVoice ? (
        <View style={styles.composer}>
          <AdaptiveTextInput
            initialValue=""
            resetKey={draftResetKey}
            onChangeText={setDraft}
            onSubmitEditing={submitDraft}
            placeholder={t("companion.compose.placeholder")}
            accessibilityLabel={t("companion.compose.placeholder")}
            style={styles.composerInput}
            testID="companion-compose-input"
          />
          <Button
            size="sm"
            variant="secondary"
            leftIcon={sendIcon}
            onPress={submitDraft}
            disabled={draft.trim().length === 0 || send.status === "pending"}
            loading={send.status === "pending"}
            accessibilityLabel={t("companion.actions.send")}
            testID="companion-send"
          />
        </View>
      ) : null}

      {send.status === "sent" ? (
        <Text style={styles.sendStatus} testID="companion-send-sent">
          {t("companion.compose.sent")}
        </Text>
      ) : null}

      {send.status === "failed" ? (
        <Alert
          variant="error"
          title={t("companion.error.sendFailed")}
          description={t(`companion.reason.${send.reasonCode ?? "unknown"}`, {
            defaultValue: t("companion.reason.unknown"),
          })}
          testID="companion-send-error"
        >
          <View style={styles.alertActions}>
            <Button size="sm" variant="secondary" onPress={retrySend} testID="companion-retry-send">
              {t("common.actions.retry")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onPress={dismissSendError}
              testID="companion-dismiss-send-error"
            >
              {t("common.actions.dismiss")}
            </Button>
          </View>
        </Alert>
      ) : null}

      <TopicsStrip topics={topics} onOpenAgent={openAgent} />
    </View>
  );
}

/** The partial is provisional, so it reads muted until the final replaces it. */
function companionStatusLabel(status: CompanionSession["status"], micState: CompanionMicState) {
  if (status === "reconnecting") return "agentPanel.states.reconnecting";
  if (status === "starting" || status === "stopping") return "companion.status.connecting";
  return `companion.micState.${micState}`;
}

function Transcript({ partial, final }: { partial: string; final: string }) {
  if (partial.length > 0) {
    return (
      <Text style={styles.transcriptPartial} testID="companion-transcript-partial">
        {partial}
      </Text>
    );
  }
  if (final.length > 0) {
    return (
      <Text style={styles.transcriptFinal} testID="companion-transcript-final">
        {final}
      </Text>
    );
  }
  return null;
}

const styles = StyleSheet.create((theme) => ({
  activeIndicator: {
    position: "absolute",
    bottom: 16,
    right: 16,
    maxWidth: "95%",
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface0,
    padding: 8,
    borderRadius: 12,
  },
  activeContext: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
    marginHorizontal: 8,
  },
  body: {
    gap: theme.spacing[3],
  },
  orbRow: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  micStateLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  transcriptPartial: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  transcriptFinal: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    textAlign: "center",
  },
  reply: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  composerInput: {
    flex: 1,
    minWidth: 0,
  },
  sendStatus: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  alertActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
