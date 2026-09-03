import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CheckCircle2, ShieldCheck } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import type { PairFlowErrorCode, PairFlowState } from "@/pairing/use-pair-with-offer";
import { isClaimOffer, offerHostname } from "@/pairing/use-pair-with-offer";
import type { Theme } from "@/styles/theme";

const FLEX_ONE_STYLE = { flex: 1 } as const;
const ThemedCheckCircle = withUnistyles(CheckCircle2);
const ThemedShieldCheck = withUnistyles(ShieldCheck);
const accentIconMapping = (theme: Theme) => ({ color: theme.colors.accent });

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  headline: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    flexShrink: 1,
  },
  body: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
  },
  mono: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  input: {
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
}));

export interface ClaimOfferPanelProps {
  state: PairFlowState;
  onRetryWithEndpoint?: (endpoint: string) => void;
  onDone?: () => void;
  onDismiss?: () => void;
  testID?: string;
}

const ERROR_KEYS: Record<PairFlowErrorCode, string> = {
  expired: "pairing.claim.errors.expired",
  token_rejected: "pairing.claim.errors.tokenRejected",
  unreachable: "pairing.claim.errors.unreachable",
  identity_mismatch: "pairing.claim.errors.identityMismatch",
  claim_failed: "pairing.claim.errors.claimFailed",
  invalid_link: "pairing.link.errors.invalid",
  connect_failed: "pairing.link.errors.unableToPair",
};

const ENDPOINT_ERRORS = new Set<PairFlowErrorCode>(["unreachable", "identity_mismatch"]);
const NEW_LINK_ERRORS = new Set<PairFlowErrorCode>(["expired", "token_rejected"]);
const RAW_MESSAGE_ERRORS = new Set<PairFlowErrorCode>([
  "claim_failed",
  "connect_failed",
  "invalid_link",
]);

function useHostLabel(state: Exclude<PairFlowState, { status: "idle" }>): string {
  const { t } = useTranslation();
  const hostname =
    (state.status === "success" ? state.hostname : null) ?? offerHostname(state.offer);
  return hostname ?? t("pairing.claim.thisDaemon");
}

function PairingCard({ state }: { state: Extract<PairFlowState, { status: "pairing" }> }) {
  const { t } = useTranslation();
  const host = useHostLabel(state);
  const claim = isClaimOffer(state.offer);
  return (
    <>
      <View style={styles.headline}>
        <ThemedShieldCheck size={18} uniProps={accentIconMapping} />
        <Text style={styles.title}>
          {claim ? t("pairing.claim.claiming", { host }) : t("pairing.link.actions.pairing")}
        </Text>
      </View>
      {claim ? <Text style={styles.body}>{t("pairing.claim.explainer")}</Text> : null}
    </>
  );
}

function SuccessCard({
  state,
  onDone,
}: {
  state: Extract<PairFlowState, { status: "success" }>;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const host = useHostLabel(state);
  const claim = isClaimOffer(state.offer);
  return (
    <>
      <View style={styles.headline}>
        <ThemedCheckCircle size={18} uniProps={accentIconMapping} />
        <Text style={styles.title}>{t("pairing.claim.successTitle")}</Text>
      </View>
      <Text style={styles.body}>
        {claim
          ? t("pairing.claim.successBody", { host })
          : t("pairing.claim.successRelayBody", { host })}
      </Text>
      {state.endpoint ? <Text style={styles.mono}>{state.endpoint}</Text> : null}
      {onDone ? (
        <Button variant="default" onPress={onDone} testID="claim-offer-done">
          {t("pairing.claim.actions.done")}
        </Button>
      ) : null}
    </>
  );
}

function ErrorCard({
  state,
  onRetryWithEndpoint,
  onDismiss,
}: {
  state: Extract<PairFlowState, { status: "error" }>;
  onRetryWithEndpoint?: (endpoint: string) => void;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const endpointRef = useRef("");
  const inputRef = useRef<EditingTextInputHandle>(null);
  const handleChangeEndpoint = useCallback((next: string) => {
    endpointRef.current = next;
  }, []);
  const handleRetry = useCallback(() => {
    onRetryWithEndpoint?.(endpointRef.current);
  }, [onRetryWithEndpoint]);

  const endpointError = ENDPOINT_ERRORS.has(state.code);
  const canRetryWithEndpoint = isClaimOffer(state.offer) && !!onRetryWithEndpoint && endpointError;
  return (
    <>
      <Text style={styles.error}>{t(ERROR_KEYS[state.code])}</Text>
      {RAW_MESSAGE_ERRORS.has(state.code) ? <Text style={styles.body}>{state.message}</Text> : null}
      {NEW_LINK_ERRORS.has(state.code) ? (
        <Text style={styles.body}>{t("pairing.claim.newLinkHint")}</Text>
      ) : null}
      {endpointError && state.endpoints.length > 0 ? (
        <Text style={styles.body}>
          {t("pairing.claim.triedEndpoints")}{" "}
          <Text style={styles.mono}>{state.endpoints.join(", ")}</Text>
        </Text>
      ) : null}
      {canRetryWithEndpoint ? (
        <>
          <Text style={styles.body}>{t("pairing.claim.manualEndpointHelper")}</Text>
          <AdaptiveTextInput
            ref={inputRef}
            testID="claim-offer-endpoint"
            accessibilityLabel={t("pairing.claim.manualEndpointLabel")}
            onChangeText={handleChangeEndpoint}
            placeholder={state.endpoints[0] ?? "192.168.1.10:9999"}
            placeholderTextColor={styles.placeholderColor.color}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </>
      ) : null}
      <View style={styles.actions}>
        {onDismiss ? (
          <Button style={FLEX_ONE_STYLE} variant="secondary" onPress={onDismiss}>
            {t("pairing.claim.actions.back")}
          </Button>
        ) : null}
        {canRetryWithEndpoint ? (
          <Button
            style={FLEX_ONE_STYLE}
            variant="default"
            onPress={handleRetry}
            testID="claim-offer-retry"
          >
            {t("pairing.claim.actions.tryAddress")}
          </Button>
        ) : null}
      </View>
    </>
  );
}

/**
 * The claim flow's copy for every state of `usePairWithOffer`: what claiming
 * means while it runs, the owner confirmation on success, and per-error
 * guidance (a new link for used/expired codes, a manual address when no
 * endpoint answered). Renders nothing while idle.
 */
export function ClaimOfferPanel({
  state,
  onRetryWithEndpoint,
  onDone,
  onDismiss,
  testID,
}: ClaimOfferPanelProps) {
  if (state.status === "idle") return null;
  let content;
  if (state.status === "pairing") {
    content = <PairingCard state={state} />;
  } else if (state.status === "success") {
    content = <SuccessCard state={state} onDone={onDone} />;
  } else {
    content = (
      <ErrorCard state={state} onRetryWithEndpoint={onRetryWithEndpoint} onDismiss={onDismiss} />
    );
  }
  return (
    <View style={styles.card} testID={testID ?? "claim-offer-panel"}>
      {content}
    </View>
  );
}
