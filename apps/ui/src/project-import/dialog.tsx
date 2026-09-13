import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { ProjectImportSession } from "@frogg/protocol/project-import/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { EditingTextInput } from "@/components/ui/text-input";
import { selectImportFiles, supportsLocalImport, type ImportFile } from "./files";
import { transferImportFiles, validateSelection } from "./transfer";

interface Props {
  client: DaemonClient;
  hostLabel: string;
  onClose: () => void;
}
// One explicit source/preview/result state machine owns the wizard.
// eslint-disable-next-line complexity
export function ProjectImportDialog({ client, hostLabel, onClose }: Props) {
  const { t } = useTranslation();
  const [source, setSource] = useState<"daemon" | "client">("daemon");
  const [cwd, setCwd] = useState("");
  const [conversationDirectory, setConversationDirectory] = useState("");
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [sessions, setSessions] = useState<ProjectImportSession[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<
    ReturnType<DaemonClient["projectImportCommit"]>
  > | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; title: string; provider: string }>>(
    [],
  );
  const [reading, setReading] = useState<{
    id: string;
    title: string;
    messages: Array<{ id: string; role: string; text: string }>;
    nextOffset: number | null;
  } | null>(null);
  const transaction = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const choose = useCallback(
    async (kind: "code" | "conversation") => {
      try {
        const chosen = await selectImportFiles(kind);
        if (!chosen.length) return;
        const next = [...files.filter((entry) => entry.kind !== kind), ...chosen];
        validateSelection(next);
        setFiles(next);
        setError(null);
      } catch (cause) {
        setError(String(cause));
      }
    },
    [files],
  );
  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);
  const preview = useCallback(
    () =>
      run(async () => {
        if (transaction.current) {
          const cancelled = await client.projectImportCancel(transaction.current);
          if (cancelled.error) throw new Error(cancelled.error);
          transaction.current = null;
        }
        const prepared = await client.projectImportPrepare({
          source,
          cwd,
          ...(source === "daemon" && conversationDirectory.trim() ? { conversationDirectory } : {}),
        });
        if (prepared.error || !prepared.importId)
          throw new Error(prepared.error ?? "Missing import transaction");
        transaction.current = prepared.importId;
        setCwd(prepared.cwd ?? cwd);
        setProjectId(prepared.projectId ?? null);
        if (prepared.projectId) {
          const saved = await client.projectImportList(prepared.projectId);
          if (saved.error) throw new Error(saved.error);
          setHistory(saved.conversations ?? []);
        } else setHistory([]);
        const abort = new AbortController();
        controller.current = abort;
        if (source === "client")
          await transferImportFiles(client, prepared.importId, files, abort.signal, (done, total) =>
            setProgress(t("projectImport.progress", { done, total })),
          );
        abort.signal.throwIfAborted();
        const response = await client.projectImportPreview(prepared.importId);
        if (response.error) throw new Error(response.error);
        setSessions(response.sessions ?? []);
        setSelected((response.sessions ?? []).map((item) => item.id));
      }),
    [client, cwd, source, files, conversationDirectory, t, run],
  );
  const commit = useCallback(
    () =>
      run(async () => {
        if (!transaction.current) return;
        const response = await client.projectImportCommit(transaction.current, selected);
        if (response.error) throw new Error(response.error);
        setResult(response);
        if (response.projectId) {
          setProjectId(response.projectId);
          const saved = await client.projectImportList(response.projectId);
          if (saved.error) throw new Error(saved.error);
          setHistory(saved.conversations ?? []);
        }
        if (response.failures?.length)
          setSelected(response.failures.map((failure) => failure.sessionId));
      }),
    [client, selected, run],
  );
  const read = useCallback(
    (id: string, offset = 0) =>
      run(async () => {
        if (!projectId) return;
        const response = await client.projectImportRead(projectId, id, offset);
        if (response.error) throw new Error(response.error);
        const incoming = (response.messages ?? []).map((message, index) => ({
          role: message.role,
          text: message.text,
          id: `${id}:${offset + index}`,
        }));
        setReading((current) => ({
          id,
          title: response.title ?? "",
          messages: offset && current?.id === id ? [...current.messages, ...incoming] : incoming,
          nextOffset: response.nextOffset ?? null,
        }));
      }),
    [client, projectId, run],
  );
  const close = useCallback(async () => {
    controller.current?.abort();
    if (busy) return;
    if (transaction.current)
      await client.projectImportCancel(transaction.current).catch(() => undefined);
    onClose();
  }, [busy, client, onClose]);
  const onClosePress = useCallback(() => void close(), [close]);
  const onReadBack = useCallback(() => setReading(null), []);
  const onMore = useCallback(() => {
    if (reading) void read(reading.id, reading.nextOffset ?? 0);
  }, [read, reading]);
  const onDaemon = useCallback(() => setSource("daemon"), []);
  const onComputer = useCallback(() => setSource("client"), []);
  const onCode = useCallback(() => void choose("code"), [choose]);
  const onConversations = useCallback(() => void choose("conversation"), [choose]);
  const onPreview = useCallback(() => void preview(), [preview]);
  const onCommit = useCallback(() => void commit(), [commit]);
  const onPreviewBack = useCallback(() => setSessions(null), []);
  const toggleSession = useCallback(
    (id: string) =>
      setSelected((current) =>
        current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      ),
    [],
  );
  const header = useMemo(() => ({ title: t("projectImport.title") }), [t]);
  return (
    <AdaptiveModalSheet visible onClose={onClosePress} header={header}>
      <ScrollView contentContainerStyle={styles.content}>
        {reading ? (
          <>
            <Button variant="ghost" onPress={onReadBack}>
              {t("projectImport.back")}
            </Button>
            <Text style={styles.text}>{reading.title}</Text>
            <Text style={styles.muted}>{t("projectImport.history")}</Text>
            {reading.messages.map((message) => (
              <View key={message.id} style={styles.row}>
                <Text style={styles.muted}>{message.role}</Text>
                <Text selectable style={styles.text}>
                  {message.text}
                </Text>
              </View>
            ))}
            {reading.nextOffset !== null ? (
              <Button disabled={busy} onPress={onMore}>
                {t("projectImport.more")}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {!sessions ? (
              <>
                <Text style={styles.text}>{t("projectImport.source")}</Text>
                <View style={styles.buttons}>
                  <Button
                    disabled={busy}
                    variant={source === "daemon" ? "default" : "outline"}
                    onPress={onDaemon}
                  >
                    {t("projectImport.daemon", { host: hostLabel })}
                  </Button>
                  {supportsLocalImport ? (
                    <Button
                      disabled={busy}
                      variant={source === "client" ? "default" : "outline"}
                      onPress={onComputer}
                    >
                      {t("projectImport.computer")}
                    </Button>
                  ) : null}
                </View>
                {!supportsLocalImport ? (
                  <Text style={styles.muted}>{t("projectImport.localUnavailable")}</Text>
                ) : null}
                <Text style={styles.text}>
                  {t("projectImport.destination", { host: hostLabel })}
                </Text>
                <EditingTextInput
                  initialValue={cwd}
                  onChangeText={setCwd}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  accessibilityLabel={t("projectImport.destination", { host: hostLabel })}
                />
                <Text style={styles.muted}>{t("projectImport.hint")}</Text>
                {source === "client" ? (
                  <>
                    <Text style={styles.muted}>{t("projectImport.history")}</Text>
                    <Button disabled={busy} variant="outline" onPress={onCode}>
                      {t("projectImport.code")}
                    </Button>
                    <Button disabled={busy} variant="outline" onPress={onConversations}>
                      {t("projectImport.conversations")}
                    </Button>
                    <Text style={styles.muted}>
                      {t("projectImport.files", { count: files.length })}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.muted}>{t("projectImport.native")}</Text>
                    <Text style={styles.text}>
                      {t("projectImport.exportsDirectory", { host: hostLabel })}
                    </Text>
                    <EditingTextInput
                      initialValue={conversationDirectory}
                      onChangeText={setConversationDirectory}
                      editable={!busy}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.input}
                      accessibilityLabel={t("projectImport.exportsDirectory", { host: hostLabel })}
                    />
                    {conversationDirectory.trim() ? (
                      <Text style={styles.muted}>{t("projectImport.history")}</Text>
                    ) : null}
                  </>
                )}
                <Button
                  disabled={
                    busy ||
                    !cwd.trim() ||
                    (source === "client" && !files.some((file) => file.kind === "conversation"))
                  }
                  onPress={onPreview}
                >
                  {t("projectImport.preview")}
                </Button>
              </>
            ) : (
              <>
                <Text style={styles.muted}>{cwd}</Text>
                {!sessions.length ? (
                  <Text style={styles.text}>{t("projectImport.empty")}</Text>
                ) : null}
                {sessions.map((session) => (
                  <SessionChoice
                    key={session.id}
                    session={session}
                    selected={selected.includes(session.id)}
                    busy={busy}
                    onSelect={toggleSession}
                  />
                ))}
                {!result || result.failures?.length ? (
                  <Button disabled={busy || !selected.length} onPress={onCommit}>
                    {t("projectImport.import")}
                  </Button>
                ) : null}
                {!result ? (
                  <Button disabled={busy} variant="ghost" onPress={onPreviewBack}>
                    {t("projectImport.back")}
                  </Button>
                ) : null}
              </>
            )}
            {result ? (
              <>
                <Text style={styles.text}>{t("projectImport.complete")}</Text>
                <Text style={styles.muted}>
                  {t("projectImport.imported", {
                    count:
                      (result.importedAgentIds?.length ?? 0) +
                      (result.skippedAgentIds?.length ?? 0) +
                      (result.importedTranscriptIds?.length ?? 0) +
                      (result.skippedTranscriptIds?.length ?? 0),
                  })}
                </Text>
                {result.failures?.length ? (
                  <>
                    <Text style={styles.text}>{t("projectImport.failures")}</Text>
                    {result.failures.map((failure) => (
                      <Text key={failure.sessionId} style={styles.muted}>
                        {failure.error}
                      </Text>
                    ))}
                  </>
                ) : null}
              </>
            ) : null}
            {history.length ? <Text style={styles.text}>{t("projectImport.saved")}</Text> : null}
            {history.map((item) => (
              <HistoryChoice key={item.id} item={item} busy={busy} onRead={read} />
            ))}
          </>
        )}
        {busy ? <Text style={styles.muted}>{progress ?? t("projectImport.busy")}</Text> : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.text}>
            {error}
          </Text>
        ) : null}
        <Button variant="ghost" disabled={busy && !controller.current} onPress={onClosePress}>
          {t(busy ? "projectImport.cancel" : "projectImport.close")}
        </Button>
      </ScrollView>
    </AdaptiveModalSheet>
  );
}
function SessionChoice({
  session,
  selected,
  busy,
  onSelect,
}: {
  session: ProjectImportSession;
  selected: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const onPress = useCallback(() => onSelect(session.id), [onSelect, session.id]);
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);
  return (
    <Pressable
      disabled={busy}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      onPress={onPress}
      style={styles.row}
    >
      <Text style={styles.text}>
        {selected ? "☑ " : "☐ "}
        {session.title}
      </Text>
      <Text style={styles.muted}>
        {session.provider} ·{" "}
        {t(session.mode === "resumable" ? "projectImport.resumable" : "projectImport.transcript")}
      </Text>
    </Pressable>
  );
}
function HistoryChoice({
  item,
  busy,
  onRead,
}: {
  item: { id: string; title: string };
  busy: boolean;
  onRead: (id: string) => Promise<void>;
}) {
  const onPress = useCallback(() => void onRead(item.id), [onRead, item.id]);
  return (
    <Button disabled={busy} variant="outline" onPress={onPress}>
      {item.title}
    </Button>
  );
}
const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.spacing[4], gap: theme.spacing[3] },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  text: { color: theme.colors.foreground },
  muted: { color: theme.colors.foregroundMuted },
  row: { padding: theme.spacing[2], gap: theme.spacing[1] },
  input: {
    color: theme.colors.foreground,
    borderColor: theme.colors.surface2,
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
  },
}));
