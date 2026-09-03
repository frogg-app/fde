import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Link } from "lucide-react-native";
import { hasOfferFragment } from "@fde/protocol/connection-offer";
import type { HostProfile } from "@/types/host-connection";
import { usePairWithOffer, type PairSuccess } from "@/pairing/use-pair-with-offer";
import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";
import { ClaimOfferPanel } from "./claim-offer-panel";
import { Button } from "@/components/ui/button";
import type { EditingTextInputHandle } from "@/components/ui/text-input";

const FLEX_ONE_STYLE = { flex: 1 } as const;

const styles = StyleSheet.create((theme) => ({
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));

export interface PairLinkModalProps {
  visible: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSaved?: (result: {
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

/**
 * "Paste pairing link": accepts `https://frogg.app/pair#offer=…`,
 * `paseo://pair#offer=…`, Paseo's `https://app.paseo.sh/#offer=…`, or a bare
 * `#offer=` fragment. A relay (v2) offer pairs and closes as before; a claim
 * (v3) offer runs the claim flow and shows its outcome before closing.
 */
export function PairLinkModal({ visible, onClose, onCancel, onSaved }: PairLinkModalProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const flow = usePairWithOffer();
  const { state, pair, retryWithEndpoint, reset } = flow;

  const offerUrlRef = useRef("");
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [validationError, setValidationError] = useState("");
  const isPairing = state.status === "pairing";

  const clearInput = useCallback(() => {
    offerUrlRef.current = "";
    inputRef.current?.replaceText("");
  }, []);

  useEffect(() => {
    if (!visible) reset();
  }, [reset, visible]);

  const pairIcon = useMemo(
    () => <Link size={16} color={theme.colors.accentForeground} />,
    [theme.colors.accentForeground],
  );

  const finish = useCallback(
    (success: PairSuccess) => {
      onSaved?.({
        profile: success.profile,
        serverId: success.serverId,
        hostname: success.hostname,
        isNewHost: success.isNewHost,
      });
      clearInput();
      setValidationError("");
      reset();
      onClose();
    },
    [clearInput, onClose, onSaved, reset],
  );

  const handleClose = useCallback(() => {
    if (isPairing) return;
    clearInput();
    setValidationError("");
    reset();
    onClose();
  }, [clearInput, isPairing, onClose, reset]);

  const handleCancel = useCallback(() => {
    if (isPairing) return;
    clearInput();
    setValidationError("");
    reset();
    (onCancel ?? onClose)();
  }, [clearInput, isPairing, onCancel, onClose, reset]);

  const handleSave = useCallback(async () => {
    if (isPairing) return;
    const raw = offerUrlRef.current.trim();
    if (!raw) {
      setValidationError(t("pairing.link.errors.required"));
      return;
    }
    if (!hasOfferFragment(raw)) {
      setValidationError(t("pairing.link.errors.missingOffer"));
      return;
    }
    setValidationError("");
    const success = await pair(raw);
    // Relay offers close straight away; claim offers show the owner confirmation first.
    if (success && success.offer.v === 2) finish(success);
  }, [finish, isPairing, pair, t]);

  const handleRetry = useCallback(
    (endpoint: string) => {
      void retryWithEndpoint(endpoint);
    },
    [retryWithEndpoint],
  );

  const handleDone = useCallback(() => {
    if (state.status === "success") finish(state);
  }, [finish, state]);

  const handleChangeOfferUrl = useCallback((next: string) => {
    offerUrlRef.current = next;
  }, []);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.link.title") }), [t]);
  const showForm = state.status === "idle" || state.status === "error";

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="pair-link-modal"
    >
      {showForm ? (
        <>
          <Text style={styles.helper}>{t("pairing.link.helper")}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t("pairing.link.label")}</Text>
            <AdaptiveTextInput
              ref={inputRef}
              testID="pair-link-input"
              nativeID="pair-link-input"
              accessibilityLabel={t("pairing.link.label")}
              onChangeText={handleChangeOfferUrl}
              placeholder="https://frogg.app/pair#offer=..."
              placeholderTextColor={theme.colors.foregroundMuted}
              style={styles.input}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            {validationError ? <Text style={styles.error}>{validationError}</Text> : null}
          </View>
        </>
      ) : null}

      <ClaimOfferPanel
        state={state}
        onRetryWithEndpoint={handleRetry}
        onDone={handleDone}
        testID="pair-link-claim-panel"
      />

      {showForm ? (
        <View style={styles.actions}>
          <Button
            style={FLEX_ONE_STYLE}
            variant="secondary"
            onPress={handleCancel}
            testID="pair-link-cancel"
            accessibilityRole="button"
            accessibilityLabel={t("pairing.link.actions.cancel")}
          >
            {t("pairing.link.actions.cancel")}
          </Button>
          <Button
            style={FLEX_ONE_STYLE}
            variant="default"
            onPress={handleSavePress}
            testID="pair-link-submit"
            accessibilityRole="button"
            accessibilityLabel={t("pairing.link.actions.pair")}
            leftIcon={pairIcon}
          >
            {t("pairing.link.actions.pair")}
          </Button>
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}
