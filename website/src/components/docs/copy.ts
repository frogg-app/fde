/**
 * Copy text and give visible + screen-reader feedback on the button.
 * The button should contain a `.label` span; its text flips to "Copied" / "Copy failed" and back.
 */
const timers = new WeakMap<HTMLElement, number>();

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for insecure contexts (e.g. previews over plain http).
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy command was rejected");
}

export async function copyWithFeedback(
  button: HTMLElement,
  text: string,
  status: HTMLElement | null,
): Promise<boolean> {
  const label = button.querySelector<HTMLElement>(".label");
  const idle = button.dataset.idleLabel ?? label?.textContent ?? "Copy";
  button.dataset.idleLabel = idle;
  let ok = true;
  try {
    await writeClipboard(text);
  } catch {
    ok = false;
  }
  button.dataset.state = ok ? "copied" : "failed";
  if (label) label.textContent = ok ? "Copied" : "Copy failed";
  if (status) status.textContent = ok ? "Copied to clipboard" : "Could not copy. Select the text and copy it manually.";
  window.clearTimeout(timers.get(button));
  timers.set(
    button,
    window.setTimeout(() => {
      delete button.dataset.state;
      if (label) label.textContent = idle;
      if (status) status.textContent = "";
    }, 1800),
  );
  return ok;
}
