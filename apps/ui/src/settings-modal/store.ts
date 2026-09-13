import { create } from "zustand";
import type { SettingsView } from "@/navigation/settings-navigation";

/**
 * The settings modal shown on wide layouts. `view` is the open section, or
 * `null` while the modal is closed. Compact layouts never open it: they keep
 * the full-screen `/settings` routes, and the modal host hands any view it
 * receives there back to the router.
 */
interface SettingsModalState {
  view: SettingsView | null;
  /** Intent id from `/settings/general?addHost=...`; the screen opens the add-host flow once per id. */
  openAddHostIntent: string | null;
  open: (view: SettingsView, openAddHostIntent?: string | null) => void;
  setView: (view: SettingsView) => void;
  close: () => void;
}

const GENERAL_VIEW: SettingsView = { kind: "section", section: "general" };

/** The compact root lists have no wide equivalent; the modal opens on their first section instead. */
function resolveModalView(view: SettingsView): SettingsView {
  if (view.kind === "root") return GENERAL_VIEW;
  if (view.kind === "hostRoot") return { kind: "host", serverId: view.serverId, section: "host" };
  return view;
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  view: null,
  openAddHostIntent: null,
  open: (view, openAddHostIntent = null) =>
    set({ view: resolveModalView(view), openAddHostIntent }),
  setView: (view) => set({ view: resolveModalView(view) }),
  close: () => set({ view: null, openAddHostIntent: null }),
}));
