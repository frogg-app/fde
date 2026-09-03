import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { BackHeader } from "@/components/headers/back-header";
import { ClaimOfferPanel } from "@/components/claim-offer-panel";
import { usePairWithOffer } from "@/pairing/use-pair-with-offer";
import { takePendingOfferUrl } from "@/pairing/pending-offer";
import { useHosts } from "@/runtime/host-runtime";
import { buildHostRootRoute, buildOpenProjectRoute } from "@/utils/host-routes";

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[6],
    gap: theme.spacing[4],
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

/**
 * Runs the pairing flow for a link that arrived from outside the app (see
 * `OfferLinkListener`). The link is taken from the pending slot once; opening
 * this screen without one just shows the paste hint and a way back.
 */
export default function PairOfferScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const hosts = useHosts();
  const { state, pair, retryWithEndpoint, reset } = usePairWithOffer();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const url = takePendingOfferUrl();
    if (url) void pair(url);
  }, [pair]);

  const goBack = useCallback(() => {
    reset();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace((hosts.length > 0 ? buildOpenProjectRoute() : "/welcome") as Href);
  }, [hosts.length, reset, router]);

  const handleDone = useCallback(() => {
    if (state.status !== "success") return;
    const serverId = state.serverId;
    reset();
    router.replace(hosts.length > 1 ? buildOpenProjectRoute() : buildHostRootRoute(serverId));
  }, [hosts.length, reset, router, state]);

  // Relay offers need no confirmation: land in the app as soon as the host is saved.
  useEffect(() => {
    if (state.status === "success" && state.offer.v === 2) handleDone();
  }, [handleDone, state]);

  const handleRetry = useCallback(
    (endpoint: string) => {
      void retryWithEndpoint(endpoint);
    },
    [retryWithEndpoint],
  );

  // The safe-area inset is runtime-only, so it rides on margin; the theme padding stays in the sheet.
  const bodyStyle = useMemo(() => [styles.body, { marginBottom: insets.bottom }], [insets.bottom]);

  return (
    <View style={styles.container} testID="pair-offer-screen">
      <BackHeader title={t("pairing.claim.title")} onBack={goBack} />
      <View style={bodyStyle}>
        {state.status === "idle" ? (
          <Text style={styles.helper}>{t("pairing.claim.noPendingOffer")}</Text>
        ) : null}
        <ClaimOfferPanel
          state={state}
          onRetryWithEndpoint={handleRetry}
          onDone={handleDone}
          onDismiss={goBack}
        />
      </View>
    </View>
  );
}
