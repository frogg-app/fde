import { isTrustedDesktopFrame } from "./ipc-policy.js";
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { pairingInbox } from "./pairing-inbox.js";

const trustedRenderers = new Map<number, { contents: WebContents; origin: string }>();

export function registerTrustedRenderer(contents: WebContents, origin: string): void {
  trustedRenderers.set(contents.id, { contents, origin });
  contents.once("destroyed", () => {
    trustedRenderers.delete(contents.id);
    pairingInbox.remove(contents.id);
  });
}

export function isTrustedRenderer(event: IpcMainInvokeEvent): boolean {
  const entry = trustedRenderers.get(event.sender.id);
  return isTrustedDesktopFrame({
    registered: entry?.contents === event.sender,
    mainFrame: event.senderFrame === event.sender.mainFrame,
    url: event.senderFrame?.url ?? "",
    origin: entry?.origin ?? "",
  });
}

export function handleDesktopIpc<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
): void {
  ipcMain.handle(channel, (event, ...args: Args) => {
    if (!isTrustedRenderer(event)) throw new Error("Untrusted desktop IPC sender");
    if (channel === "frogg:invoke" && args[0] === "pairing_offer_ready") {
      return pairingInbox.ready(event.sender.id, (url) => {
        event.sender.send("frogg:event:open-pairing-offer", { url });
      });
    }
    return handler(event, ...args);
  });
}
