import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";

export interface DirectConnectionErrorLabels {
  failedToConnect: (endpoint: string) => string;
  noAdditionalDetails: (detail: string) => string;
  timedOut: string;
  refused: string;
  hostNotFound: string;
  hostUnreachable: string;
  tlsError: string;
  unableToConnect: string;
}

function normalizeTransportMessage(message: string | null | undefined): string | null {
  const trimmed = message?.trim();
  return trimmed ? trimmed : null;
}

function formatTechnicalTransportDetails(
  details: (string | null)[],
  labels: DirectConnectionErrorLabels,
): string | null {
  const unique = Array.from(
    new Set(
      details
        .map((value) => normalizeTransportMessage(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (unique.length === 0) return null;

  const allGeneric = unique.every((value) => {
    const lower = value.toLowerCase();
    return lower === "transport error" || lower === "transport closed";
  });

  if (allGeneric) {
    return labels.noAdditionalDetails(unique[0] ?? "");
  }

  return unique.join(" — ");
}

/** Title + human detail + raw transport text for a failed direct connection attempt. */
export function buildConnectionFailureCopy(input: {
  endpoint: string;
  error: unknown;
  labels: DirectConnectionErrorLabels;
}): { title: string; detail: string | null; raw: string | null } {
  const { endpoint, error, labels } = input;
  const title = labels.failedToConnect(endpoint);

  const raw = (() => {
    if (error instanceof DaemonConnectionTestError) {
      return (
        formatTechnicalTransportDetails([error.reason, error.lastError], labels) ??
        normalizeTransportMessage(error.message)
      );
    }
    if (error instanceof Error) {
      return normalizeTransportMessage(error.message);
    }
    return null;
  })();

  const rawLower = raw?.toLowerCase() ?? "";
  let detail: string | null;

  if (raw === "Incorrect password" || raw === "Password required") {
    detail = raw;
  } else if (rawLower.includes("timed out")) {
    detail = labels.timedOut;
  } else if (
    rawLower.includes("econnrefused") ||
    rawLower.includes("connection refused") ||
    rawLower.includes("err_connection_refused")
  ) {
    detail = labels.refused;
  } else if (rawLower.includes("enotfound") || rawLower.includes("not found")) {
    detail = labels.hostNotFound;
  } else if (rawLower.includes("ehostunreach") || rawLower.includes("host is unreachable")) {
    detail = labels.hostUnreachable;
  } else if (
    rawLower.includes("certificate") ||
    rawLower.includes("tls") ||
    rawLower.includes("ssl")
  ) {
    detail = labels.tlsError;
  } else {
    detail = labels.unableToConnect;
  }

  return { title, detail, raw };
}

/** One multi-line message combining title, detail and (when it adds something) the raw text. */
export function formatConnectionFailureMessage(input: {
  endpoint: string;
  error: unknown;
  labels: DirectConnectionErrorLabels;
  detailsLabel: (detail: string) => string;
}): string {
  const { title, detail, raw } = buildConnectionFailureCopy(input);
  if (raw && detail && raw !== detail) {
    return `${title}\n${detail}\n${input.detailsLabel(raw)}`;
  }
  return detail ? `${title}\n${detail}` : title;
}
