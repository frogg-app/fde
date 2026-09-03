import { useCallback, useRef, useState } from "react";
import {
  parseAnyConnectionOfferFromUrl,
  type AnyConnectionOffer,
} from "@fde/protocol/connection-offer";
import type { HostProfile } from "@/types/host-connection";
import { useHosts, useHostMutations } from "@/runtime/host-runtime";
import { normalizeHostPort } from "@/utils/daemon-endpoints";
import { connectToDaemon } from "@/utils/test-daemon-connection";
import { ClaimOfferError, type ClaimOfferErrorCode } from "./claim-offer";

/**
 * One state machine for every place the app accepts a pairing link: the paste
 * modal, the QR scanner, and links opened from outside (web fragment, native
 * URL, desktop `open-pairing-offer`). A v2 offer is the relay flow that already
 * existed; a v3 offer runs the claim flow against an unclaimed FDE daemon.
 */
export type PairFlowErrorCode = ClaimOfferErrorCode | "invalid_link" | "connect_failed";

export type PairFlowState =
  | { status: "idle" }
  | { status: "pairing"; offer: AnyConnectionOffer; hostname: string | null }
  | {
      status: "success";
      offer: AnyConnectionOffer;
      profile: HostProfile;
      serverId: string;
      hostname: string | null;
      isNewHost: boolean;
      endpoint: string | null;
    }
  | {
      status: "error";
      offer: AnyConnectionOffer | null;
      code: PairFlowErrorCode;
      message: string;
      endpoints: readonly string[];
    };

export interface PairSuccess extends Extract<PairFlowState, { status: "success" }> {}

export function offerHostname(offer: AnyConnectionOffer | null): string | null {
  return offer?.v === 3 ? (offer.hostname ?? null) : null;
}

export function isClaimOffer(offer: AnyConnectionOffer | null): boolean {
  return offer?.v === 3;
}

export interface PairWithOfferController {
  state: PairFlowState;
  /** Parse a link (or bare `#offer=` fragment) and pair. Resolves to the success state or null. */
  pair: (offerUrl: string) => Promise<PairSuccess | null>;
  /** Re-run a v3 claim against an endpoint the user typed. */
  retryWithEndpoint: (endpoint: string) => Promise<PairSuccess | null>;
  reset: () => void;
}

export function usePairWithOffer(): PairWithOfferController {
  const hosts = useHosts();
  const { upsertConnectionFromOffer, claimAndUpsertDirectOffer } = useHostMutations();
  const [state, setState] = useState<PairFlowState>({ status: "idle" });
  const lastOfferRef = useRef<AnyConnectionOffer | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(
    async (offer: AnyConnectionOffer, endpointOverride?: string): Promise<PairSuccess | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;
      lastOfferRef.current = offer;
      const isNewHost = !hosts.some((host) => host.serverId === offer.serverId);
      setState({ status: "pairing", offer, hostname: offerHostname(offer) });
      try {
        let success: PairSuccess;
        if (offer.v === 3) {
          const result = await claimAndUpsertDirectOffer(
            offer,
            endpointOverride ? { endpointOverride } : {},
          );
          success = {
            status: "success",
            offer,
            profile: result.profile,
            serverId: result.serverId,
            hostname: result.hostname,
            isNewHost,
            endpoint: result.endpoint,
          };
        } else {
          const { client, hostname } = await connectToDaemon(
            {
              id: "probe",
              type: "relay",
              relayEndpoint: normalizeHostPort(offer.relay.endpoint),
              useTls: offer.relay.useTls,
              daemonPublicKeyB64: offer.daemonPublicKeyB64,
            },
            { serverId: offer.serverId },
          );
          await client.close().catch(() => undefined);
          const profile = await upsertConnectionFromOffer(offer, hostname ?? undefined);
          success = {
            status: "success",
            offer,
            profile,
            serverId: offer.serverId,
            hostname,
            isNewHost,
            endpoint: null,
          };
        }
        setState(success);
        return success;
      } catch (error) {
        let code: PairFlowErrorCode = "connect_failed";
        let endpoints: readonly string[] = offer.v === 3 ? offer.direct.endpoints : [];
        if (error instanceof ClaimOfferError) {
          code = error.code;
          endpoints = error.endpoints;
        }
        setState({
          status: "error",
          offer,
          code,
          message: error instanceof Error ? error.message : String(error),
          endpoints,
        });
        return null;
      } finally {
        busyRef.current = false;
      }
    },
    [claimAndUpsertDirectOffer, hosts, upsertConnectionFromOffer],
  );

  const pair = useCallback(
    async (offerUrl: string): Promise<PairSuccess | null> => {
      let offer: AnyConnectionOffer | null;
      try {
        offer = parseAnyConnectionOfferFromUrl(offerUrl);
      } catch (error) {
        offer = null;
        setState({
          status: "error",
          offer: null,
          code: "invalid_link",
          message: error instanceof Error ? error.message : String(error),
          endpoints: [],
        });
        return null;
      }
      if (!offer) {
        setState({
          status: "error",
          offer: null,
          code: "invalid_link",
          message: "Missing #offer= fragment",
          endpoints: [],
        });
        return null;
      }
      return run(offer);
    },
    [run],
  );

  const retryWithEndpoint = useCallback(
    async (endpoint: string): Promise<PairSuccess | null> => {
      const offer = lastOfferRef.current;
      if (!offer || offer.v !== 3) return null;
      const trimmed = endpoint.trim();
      return run(offer, trimmed.length > 0 ? trimmed : undefined);
    },
    [run],
  );

  const reset = useCallback(() => {
    lastOfferRef.current = null;
    setState({ status: "idle" });
  }, []);

  return { state, pair, retryWithEndpoint, reset };
}
