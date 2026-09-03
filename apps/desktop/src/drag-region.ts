// Window dragging for the custom-chrome platforms (Windows, Linux).
//
// The UI marks its drag surfaces Electron-style (`-webkit-app-region: drag`,
// which WebView2/WebKitGTK ignore) and with `data-tauri-drag-region`. Tauri's
// own injected handler only reacts when the mousedown *target itself* carries
// the attribute; a header's text and icons sit above the surface, so nothing
// ever fired. This handler walks up from the target instead: an interactive
// element on the way cancels the drag, a drag surface starts it.

import { getCurrentWindow } from "@tauri-apps/api/window";

const DRAG_ATTRIBUTE = "data-tauri-drag-region";

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  '[role="button"]',
  '[role="textbox"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="slider"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="combobox"]',
].join(",");

export type DragSurfaceVerdict = "drag" | "interactive" | "none";

function appRegionOf(element: Element, view: Window): string {
  const style = view.getComputedStyle(element) as CSSStyleDeclaration & {
    webkitAppRegion?: string;
    appRegion?: string;
  };
  return (
    style.getPropertyValue("-webkit-app-region") ||
    style.getPropertyValue("app-region") ||
    style.webkitAppRegion ||
    style.appRegion ||
    ""
  ).trim();
}

/**
 * Classifies the element under the pointer by walking its ancestors. The
 * first element that decides wins: an interactive control (or an explicit
 * opt-out) means "leave the event alone", a drag surface means "drag".
 */
function elementOf(target: EventTarget | null): Element | null {
  if (!target || typeof target !== "object") return null;
  const node = target as Node;
  if (node.nodeType === 1) return node as Element; // ELEMENT_NODE
  return node.parentElement ?? null;
}

export function classifyDragTarget(target: EventTarget | null, view: Window): DragSurfaceVerdict {
  let element = elementOf(target);
  while (element) {
    if (element.getAttribute(DRAG_ATTRIBUTE) === "false") return "interactive";
    if (element.matches(INTERACTIVE_SELECTOR)) return "interactive";
    const region = appRegionOf(element, view);
    if (region === "no-drag") return "interactive";
    if (element.hasAttribute(DRAG_ATTRIBUTE) || region === "drag") return "drag";
    element = element.parentElement;
  }
  return "none";
}

export interface DragRegionWindow {
  startDragging: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  isFullscreen: () => Promise<boolean>;
}

/**
 * Installs the capture-phase listeners. `resolveWindow` is injectable so the
 * bridge tests can run it against a stub; the shell passes Tauri's window.
 */
export function installDragRegionHandler(
  view: Window,
  resolveWindow: () => DragRegionWindow = () => getCurrentWindow(),
): () => void {
  let fullscreen = false;
  const refreshFullscreen = () => {
    resolveWindow()
      .isFullscreen()
      .then((value) => {
        fullscreen = value;
        return value;
      })
      .catch(() => false);
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    if (classifyDragTarget(event.target, view) !== "drag") return;
    // Text selection would otherwise start on the header before the OS takes
    // the pointer; the surfaces carry `user-select: none` but the event still
    // needs cancelling for WebView2 to hand the drag over cleanly.
    event.preventDefault();
    refreshFullscreen();
    if (fullscreen) return;
    // Same rule as Tauri's own handler: once the OS owns the pointer for a
    // drag the webview may never see the matching `dblclick`, so the second
    // press of a double-click (`detail === 2`) is what toggles maximize.
    const win = resolveWindow();
    const action = event.detail === 2 ? win.toggleMaximize() : win.startDragging();
    action.catch((error) => console.warn("[FDE] window drag failed", error));
  };

  view.addEventListener("mousedown", onMouseDown, true);
  return () => {
    view.removeEventListener("mousedown", onMouseDown, true);
  };
}
