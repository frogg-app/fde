import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DirectConnectionErrorLabels } from "./add-host-connection-errors";

/** Translated copy for a failed direct connection, shared by the form and the network list. */
export function useDirectConnectionErrorLabels(): DirectConnectionErrorLabels {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      failedToConnect: (endpoint: string) =>
        t("pairing.direct.errors.failedToConnect", { endpoint }),
      noAdditionalDetails: (detail: string) =>
        t("pairing.direct.errors.noAdditionalDetails", { detail }),
      timedOut: t("pairing.direct.errors.timedOut"),
      refused: t("pairing.direct.errors.refused"),
      hostNotFound: t("pairing.direct.errors.hostNotFound"),
      hostUnreachable: t("pairing.direct.errors.hostUnreachable"),
      tlsError: t("pairing.direct.errors.tlsError"),
      unableToConnect: t("pairing.direct.errors.unableToConnect"),
    }),
    [t],
  );
}
