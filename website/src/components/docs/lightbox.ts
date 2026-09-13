/** A single shared <dialog> lightbox that zooms out of the clicked image and back into it. */

interface OpenOptions {
  src: string;
  alt: string;
  origin: Element;
  returnFocus: HTMLElement;
}

let dialog: HTMLDialogElement | null = null;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function ensureDialog(): HTMLDialogElement {
  if (dialog?.isConnected) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "fde-lightbox";
  dialog.setAttribute("aria-label", "Enlarged screenshot");
  dialog.innerHTML = `
    <button type="button" class="fde-lightbox-close" aria-label="Close (Esc)">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <img class="fde-lightbox-img" alt="" decoding="async" />
    <p class="fde-lightbox-hint" aria-hidden="true">Click anywhere or press Esc to close</p>`;
  const style = document.createElement("style");
  style.textContent = `
    .fde-lightbox{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:clamp(0.75rem,3vw,2.5rem);border:0;background:transparent;display:none;place-items:center;overflow:hidden;cursor:zoom-out;color:#fff}
    .fde-lightbox[open]{display:grid}
    .fde-lightbox::backdrop{background:rgb(4 8 9/.82);backdrop-filter:blur(8px);opacity:0;transition:opacity 220ms ease}
    .fde-lightbox.is-open::backdrop{opacity:1}
    .fde-lightbox-img{max-width:100%;max-height:calc(100dvh - 5rem);width:auto;height:auto;border-radius:12px;box-shadow:0 30px 90px -20px rgb(0 0 0/.8);transform-origin:top left;will-change:transform}
    .fde-lightbox-close{position:absolute;top:1rem;right:1rem;display:grid;place-items:center;width:2.75rem;height:2.75rem;border-radius:999px;border:1px solid rgb(255 255 255/.2);background:rgb(255 255 255/.08);color:#fff;cursor:pointer;transition:background-color 140ms ease,transform 140ms ease}
    .fde-lightbox-close:hover{background:rgb(255 255 255/.18)}
    .fde-lightbox-close:active{transform:scale(.92)}
    .fde-lightbox-close:focus-visible{outline:2px solid #7fd9e6;outline-offset:2px}
    .fde-lightbox-hint{position:absolute;bottom:.75rem;left:0;right:0;margin:0;text-align:center;font-size:.8rem;opacity:.65}`;
  document.head.append(style);
  document.body.append(dialog);

  dialog.addEventListener("click", (event) => {
    if ((event.target as Element).closest(".fde-lightbox-close") || event.target === dialog || event.target instanceof HTMLImageElement || event.target instanceof HTMLParagraphElement) {
      void closeLightbox();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    void closeLightbox();
  });
  return dialog;
}

let current: OpenOptions | null = null;

function flip(img: HTMLImageElement, from: DOMRect, reverse: boolean): Promise<void> {
  const to = img.getBoundingClientRect();
  if (!to.width || !to.height) return Promise.resolve();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const collapsed = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  const frames = [{ transform: collapsed }, { transform: "none" }];
  const animation = img.animate(reverse ? frames.reverse() : frames, {
    duration: reverse ? 200 : 300,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    fill: "both",
  });
  return animation.finished.then(() => undefined).catch(() => undefined);
}

export async function openLightbox(options: OpenOptions): Promise<void> {
  const box = ensureDialog();
  const img = box.querySelector<HTMLImageElement>(".fde-lightbox-img")!;
  current = options;
  const originRect = options.origin.getBoundingClientRect();
  // Show the already-loaded inline image instantly, then swap in the full-size one.
  const inline = options.origin instanceof HTMLImageElement ? options.origin.currentSrc : "";
  img.getAnimations().forEach((a) => a.cancel());
  img.alt = options.alt;
  if (inline) img.src = inline;
  box.showModal();
  box.querySelector<HTMLButtonElement>(".fde-lightbox-close")?.focus({ preventScroll: true });
  requestAnimationFrame(() => box.classList.add("is-open"));
  if (!reducedMotion()) await flip(img, originRect, false);
  if (img.src !== new URL(options.src, location.href).href) {
    const full = new Image();
    full.src = options.src;
    full.decode().then(
      () => {
        if (current === options) img.src = options.src;
      },
      () => undefined,
    );
  }
}

export async function closeLightbox(): Promise<void> {
  if (!dialog?.open || !current) return;
  const { origin, returnFocus } = current;
  const img = dialog.querySelector<HTMLImageElement>(".fde-lightbox-img")!;
  dialog.classList.remove("is-open");
  if (!reducedMotion()) await flip(img, origin.getBoundingClientRect(), true);
  dialog.close();
  img.getAnimations().forEach((a) => a.cancel());
  current = null;
  returnFocus.focus({ preventScroll: true });
}
