import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EditingTextInput } from "@/components/ui/text-input";
import { VolumeMeter } from "@/components/volume-meter";
import { useDictation } from "@/hooks/use-dictation";
import { useSettings } from "@/hooks/use-settings";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { alertKey } from "@/spoken-alerts/state";
import { useSpokenAlertsStore } from "@/spoken-alerts/store";
import {
  reduceVoiceReply,
  type VoiceReplyAction,
  type VoiceReplyContext,
  type VoiceReplyEvent,
  type VoiceReplyPhase,
} from "@/spoken-alerts/voice-reply-state";
import { useSessionStore } from "@/stores/session-store";

const COUNTDOWN_TICK_MS = 250;
const CLOSE_AFTER_SENT_MS = 600;
const INITIAL_PHASE: VoiceReplyPhase = { status: "listening" };

function useCountdown(autoSendAt: number | null, onElapsed: () => void): number | null {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const onElapsedRef = useRef(onElapsed);
  useEffect(() => {
    onElapsedRef.current = onElapsed;
  }, [onElapsed]);
  useEffect(() => {
    if (autoSendAt === null) {
      setRemainingMs(null);
      return;
    }
    const tick = () => {
      const remaining = autoSendAt - Date.now();
      if (remaining <= 0) {
        setRemainingMs(0);
        onElapsedRef.current();
        return;
      }
      setRemainingMs(remaining);
    };
    tick();
    const timer = setInterval(tick, COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, [autoSendAt]);
  return remainingMs;
}

/**
 * Captures a spoken reply for the agent behind the latest alert, shows the transcript for a
 * moment so it can be edited or cancelled, then sends it as the next message or as the
 * decision on the pending permission request.
 */
export function VoiceReplySheet() {
  const target = useSpokenAlertsStore((state) => state.voiceReply);
  if (!target) return null;
  return (
    <VoiceReplySheetBody
      key={`${target.serverId}:${target.agentId}`}
      serverId={target.serverId}
      agentId={target.agentId}
    />
  );
}

function VoiceReplySheetBody({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const closeVoiceReply = useSpokenAlertsStore((state) => state.closeVoiceReply);
  const dispatchAlert = useSpokenAlertsStore((state) => state.dispatch);
  const handsFree = useSpokenAlertsStore((state) => state.handsFree);
  const setHandsFree = useSpokenAlertsStore((state) => state.setHandsFree);
  const confirmBeforeSend = useSettings((settings) => settings.voiceReplyConfirm);
  const pendingPermissionId = useSessionStore((state) => {
    const permissions = state.sessions[serverId]?.agents.get(agentId)?.pendingPermissions ?? [];
    return permissions[permissions.length - 1]?.id ?? null;
  });

  const contextRef = useRef<VoiceReplyContext>({ pendingPermission: null, confirmBeforeSend });
  contextRef.current = {
    pendingPermission: pendingPermissionId ? { requestId: pendingPermissionId } : null,
    confirmBeforeSend,
  };
  const [phase, dispatch] = useReducer(
    (current: VoiceReplyPhase, event: VoiceReplyEvent) =>
      reduceVoiceReply(current, event, contextRef.current),
    INITIAL_PHASE,
  );
  const [startError, setStartError] = useState<string | null>(null);

  const onTranscript = useCallback(
    (text: string) => dispatch({ type: "transcript", text, now: Date.now() }),
    [],
  );
  const onDictationError = useCallback((error: Error) => setStartError(error.message), []);
  const canUseClient = useCallback(() => client?.isConnected ?? false, [client]);
  const dictation = useDictation({
    client,
    onTranscript,
    onError: onDictationError,
    canStart: canUseClient,
    canConfirm: canUseClient,
  });
  const { startDictation, cancelDictation, confirmDictation, isProcessing } = dictation;

  useEffect(() => {
    if (phase.status !== "listening") return;
    setStartError(null);
    startDictation().catch((error: unknown) => {
      setStartError(error instanceof Error ? error.message : t("spokenAlerts.reply.startFailed"));
    });
    return () => {
      void cancelDictation();
    };
  }, [cancelDictation, phase.status, startDictation, t]);

  useEffect(() => {
    if (isProcessing) dispatch({ type: "transcribing" });
  }, [isProcessing]);

  useEffect(() => {
    if (phase.status !== "sending" || !client) return;
    const action = phase.action;
    const send = async () => {
      if (action.kind === "permission") {
        await client.respondToPermission(agentId, action.requestId, { behavior: action.behavior });
        return;
      }
      if (action.kind === "message") {
        await client.sendAgentMessage(agentId, action.text);
      }
    };
    send()
      .then(() => {
        dispatch({ type: "sent" });
        dispatchAlert({ type: "dismissed", key: alertKey(serverId, agentId) });
        return undefined;
      })
      .catch((error: unknown) => {
        dispatch({
          type: "failed",
          message: error instanceof Error ? error.message : t("spokenAlerts.reply.failed"),
        });
      });
  }, [agentId, client, dispatchAlert, phase, serverId, t]);

  useEffect(() => {
    if (phase.status !== "sent") return;
    const timer = setTimeout(closeVoiceReply, CLOSE_AFTER_SENT_MS);
    return () => clearTimeout(timer);
  }, [closeVoiceReply, phase.status]);

  const send = useCallback(() => dispatch({ type: "send" }), []);
  const retry = useCallback(() => dispatch({ type: "retry" }), []);
  const edit = useCallback((text: string) => dispatch({ type: "edited", text }), []);
  const choose = useCallback(
    (action: VoiceReplyAction) => dispatch({ type: "choose", action }),
    [],
  );
  const finishListening = useCallback(() => void confirmDictation(), [confirmDictation]);
  const autoSendAt = phase.status === "confirming" ? phase.autoSendAt : null;
  const remainingMs = useCountdown(autoSendAt, send);
  const header = useMemo(() => ({ title: t("spokenAlerts.reply.title") }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.footerRow}>
        <Text style={styles.footerLabel}>{t("spokenAlerts.reply.keepListening")}</Text>
        <Switch
          value={handsFree}
          onValueChange={setHandsFree}
          accessibilityLabel={t("spokenAlerts.reply.keepListening")}
          testID="voice-reply-hands-free"
        />
      </View>
    ),
    [handsFree, setHandsFree, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={closeVoiceReply}
      testID="voice-reply-sheet"
      desktopMaxWidth={480}
      footer={footer}
    >
      <View style={styles.body}>
        {pendingPermissionId ? (
          <Text style={styles.hint}>{t("spokenAlerts.reply.permissionPrompt")}</Text>
        ) : null}
        {phase.status === "listening" || phase.status === "transcribing" ? (
          <ListeningView
            status={phase.status}
            volume={dictation.volume}
            partialTranscript={dictation.partialTranscript}
            startError={startError ?? dictation.error}
            onDone={finishListening}
            onCancel={closeVoiceReply}
          />
        ) : null}
        {phase.status === "confirming" ? (
          <ConfirmView
            phase={phase}
            remainingMs={remainingMs}
            onEdit={edit}
            onSend={send}
            onChoose={choose}
            onCancel={closeVoiceReply}
          />
        ) : null}
        {phase.status === "sending" ? (
          <Text style={styles.status}>{t("spokenAlerts.reply.sending")}</Text>
        ) : null}
        {phase.status === "sent" ? (
          <Text style={styles.status}>{t("spokenAlerts.reply.sent")}</Text>
        ) : null}
        {phase.status === "failed" ? (
          <View style={styles.stack}>
            <Text style={styles.error}>{phase.message}</Text>
            <View style={styles.actions}>
              <Button size="sm" variant="secondary" onPress={retry}>
                {t("spokenAlerts.reply.retry")}
              </Button>
              <Button size="sm" variant="ghost" onPress={closeVoiceReply}>
                {t("spokenAlerts.reply.cancel")}
              </Button>
            </View>
          </View>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function ListeningView({
  status,
  volume,
  partialTranscript,
  startError,
  onDone,
  onCancel,
}: {
  status: "listening" | "transcribing";
  volume: number;
  partialTranscript: string;
  startError: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.stack}>
      <View style={styles.meter}>
        <VolumeMeter volume={volume} isSpeaking={status === "listening"} orientation="horizontal" />
      </View>
      <Text style={styles.status}>
        {status === "listening"
          ? t("spokenAlerts.reply.listening")
          : t("spokenAlerts.reply.transcribing")}
      </Text>
      {partialTranscript ? <Text style={styles.transcript}>{partialTranscript}</Text> : null}
      {startError ? <Text style={styles.error}>{startError}</Text> : null}
      <View style={styles.actions}>
        <Button
          size="sm"
          variant="default"
          onPress={onDone}
          disabled={status !== "listening"}
          testID="voice-reply-done"
        >
          {t("spokenAlerts.reply.done")}
        </Button>
        <Button size="sm" variant="ghost" onPress={onCancel}>
          {t("spokenAlerts.reply.cancel")}
        </Button>
      </View>
    </View>
  );
}

function ConfirmView({
  phase,
  remainingMs,
  onEdit,
  onSend,
  onChoose,
  onCancel,
}: {
  phase: Extract<VoiceReplyPhase, { status: "confirming" }>;
  remainingMs: number | null;
  onEdit: (text: string) => void;
  onSend: () => void;
  onChoose: (action: VoiceReplyAction) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const action = phase.action;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const text = phase.text.trim();
  const requestId = action.kind === "permission_ambiguous" ? action.requestId : null;
  const allow = useCallback(() => {
    if (requestId) onChoose({ kind: "permission", requestId, behavior: "allow" });
  }, [onChoose, requestId]);
  const deny = useCallback(() => {
    if (requestId) onChoose({ kind: "permission", requestId, behavior: "deny" });
  }, [onChoose, requestId]);
  const sendAsMessage = useCallback(() => onChoose({ kind: "message", text }), [onChoose, text]);
  return (
    <View style={styles.stack}>
      <EditingTextInput
        initialValue={phase.text}
        onChangeText={onEdit}
        multiline
        style={styles.input}
        placeholder={t("spokenAlerts.reply.placeholder")}
        testID="voice-reply-transcript"
      />
      {action.kind === "permission" ? (
        <Text style={styles.status}>
          {action.behavior === "allow"
            ? t("spokenAlerts.reply.willAllow")
            : t("spokenAlerts.reply.willDeny")}
        </Text>
      ) : null}
      {action.kind === "permission_ambiguous" ? (
        <Text style={styles.status}>{t("spokenAlerts.reply.ambiguous")}</Text>
      ) : null}
      {seconds !== null ? (
        <Text style={styles.status}>{t("spokenAlerts.reply.sendingIn", { seconds })}</Text>
      ) : null}
      <View style={styles.actions}>
        {requestId ? (
          <>
            <Button size="sm" variant="secondary" onPress={allow} testID="voice-reply-allow">
              {t("spokenAlerts.reply.allow")}
            </Button>
            <Button size="sm" variant="secondary" onPress={deny} testID="voice-reply-deny">
              {t("spokenAlerts.reply.deny")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onPress={sendAsMessage}
              disabled={text.length === 0}
              testID="voice-reply-send-message"
            >
              {t("spokenAlerts.reply.sendAsMessage")}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="default"
            onPress={onSend}
            disabled={text.length === 0}
            testID="voice-reply-send"
          >
            {t("spokenAlerts.reply.send")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onPress={onCancel}>
          {t("spokenAlerts.reply.cancel")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  stack: {
    gap: theme.spacing[3],
  },
  meter: {
    height: 32,
    justifyContent: "center",
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  status: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
  },
  transcript: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
  },
  input: {
    minHeight: 88,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  footerLabel: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
