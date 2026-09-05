import { Mic, MicOff, SendHorizontal, Square } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildCompanionTopicRows } from "./topic-rows";
import { MicOrb } from "./mic-orb";
import { getCompanionRuntime, getCompanionSession } from "./session-registry";
import { deriveCompanionMicState, useCompanionStore } from "./store";
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
  const isOpen = useCompanionStore((state) => state.isOpen);
  const close = useCompanionStore((state) => state.close);
  const host = useCompanionHost();
  const header = useMemo<SheetHeader>(() => ({ title: t("companion.title") }), [t]);

  return (
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
          unavailableReason={host.unavailableReason}
          isAvailable={host.isAvailable}
        />
      ) : null}
    </AdaptiveModalSheet>
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
  const sessionStarting = useCompanionStore((state) => state.sessionStarting);
  const sessionStopping = useCompanionStore((state) => state.sessionStopping);
  const dismissSessionError = useCompanionStore((state) => state.dismissSessionError);
  const dismissSendError = useCompanionStore((state) => state.dismissSendError);

  const { settings } = useSettings();
  const [draft, setDraft] = useState("");
  // The input is uncontrolled, so clearing it after a send means remounting the
  // value rather than writing an empty string back through the prop.
  const [draftResetKey, setDraftResetKey] = useState(0);
  const micState = deriveCompanionMicState({ session, isMuted, isSpeaking, isThinking });
  const isBusy = session.status === "starting" || session.status === "stopping";
  const isSessionOpen = session.status === "open";

  const start = useCallback(() => {
    if (!serverId) return;
    const adapter = getCompanionSession(serverId);
    if (!adapter) return;
    sessionStarting();
    void getCompanionRuntime().start(adapter);
  }, [serverId, sessionStarting]);

  const stop = useCallback(() => {
    sessionStopping();
    void getCompanionRuntime().stop();
  }, [sessionStopping]);

  // Opening the surface opens the conversation, because the Companion's whole
  // premise is that you talk to it. Users who would rather press first turn this
  // off in settings.
  useEffect(() => {
    if (!settings.companionAutoStart) return;
    if (!isAvailable || session.status !== "closed") return;
    start();
  }, [isAvailable, session.status, settings.companionAutoStart, start]);

  // The Companion stops with the surface; a session left running would keep the
  // microphone open behind a closed sheet.
  useEffect(() => {
    return () => {
      if (getCompanionRuntime().isActive()) {
        void getCompanionRuntime().stop();
      }
    };
  }, []);

  const toggleMute = useCallback(() => getCompanionRuntime().toggleMute(), []);

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

  if (!isAvailable) {
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
          accessibilityLabel={t(`companion.micState.${micState}`)}
          onPress={isSessionOpen ? toggleMute : start}
          testID="companion-mic-orb"
        />
        <Text style={styles.micStateLabel} testID="companion-mic-state">
          {isBusy ? t("companion.status.connecting") : t(`companion.micState.${micState}`)}
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
          disabled={!isSessionOpen}
          loading={session.status === "stopping"}
          testID="companion-stop"
        >
          {t("companion.actions.stop")}
        </Button>
      </View>

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
