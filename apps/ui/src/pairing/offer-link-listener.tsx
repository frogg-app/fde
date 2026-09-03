import { useEffect } from "react";
import * as Linking from "expo-linking";
import { useRouter, type Href } from "expo-router";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { getDesktopHost } from "@/desktop/host";
import { useStableEvent } from "@/hooks/use-stable-event";
import { extractOfferLink, setPendingOfferUrl } from "./pending-offer";

export const PAIR_OFFER_ROUTE = "/pair-offer" as Href;

/**
 * Pairing links that reach the app from outside: the page URL on web
 * (`#offer=` or `?offer=`), `Linking` on native, and the desktop shell's
 * `open-pairing-offer` event for `paseo://pair#offer=…` (`launch.rs`). Each is
 * parked in the pending-offer slot and the `/pair-offer` screen runs the flow,
 * so a claim's progress and errors are shown instead of logged.
 */
export function OfferLinkListener() {
  const router = useRouter();

  const openOffer = useStableEvent((rawUrl: string | null | undefined) => {
    const link = extractOfferLink(rawUrl);
    if (!link) return;
    setPendingOfferUrl(link);
    router.push(PAIR_OFFER_ROUTE);
  });

  useEffect(() => {
    void Linking.getInitialURL()
      .then((url) => openOffer(url))
      .catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => openOffer(event.url));
    return () => subscription.remove();
  }, [openOffer]);

  useEffect(() => {
    const host = getDesktopHost();
    const invoke = host?.invoke;
    if (typeof host?.events?.on !== "function" || typeof invoke !== "function") return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    const readUrl = (payload: unknown): string | null =>
      payload &&
      typeof payload === "object" &&
      typeof (payload as { url?: unknown }).url === "string"
        ? (payload as { url: string }).url
        : null;

    const connect = async () => {
      try {
        const dispose = await listenToDesktopEvent<unknown>("open-pairing-offer", (payload) =>
          openOffer(readUrl(payload)),
        );
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
        // Anything queued before the listener existed (a link that launched the app).
        const pending = await invoke("pairing_offer_ready");
        if (!disposed) openOffer(readUrl(pending));
      } catch (error) {
        console.warn("[Pairing] Desktop pairing-offer bridge unavailable", error);
      }
    };
    void connect();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openOffer]);

  return null;
}
