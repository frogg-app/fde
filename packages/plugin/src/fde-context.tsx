import type { FdeApi } from "@fde/client";
import { createContext, useContext, type ReactNode } from "react";

const FdeApiContext = createContext<FdeApi | null>(null);

export function useFdeContextValue(): FdeApi | null {
  return useContext(FdeApiContext);
}

export function FdeApiProvider({ children, fde }: { children: ReactNode; fde: FdeApi }) {
  return <FdeApiContext.Provider value={fde}>{children}</FdeApiContext.Provider>;
}

export function useFde(): FdeApi {
  const fde = useFdeContextValue();
  if (!fde) throw new Error("useFde must run inside a contributed plugin surface");
  return fde;
}
