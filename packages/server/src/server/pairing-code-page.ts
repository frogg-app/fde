/**
 * The pairing landing page behind `https://pair.frogg.app/code/<code>`: the
 * daemon renders it itself, so an owner can point that hostname at their own
 * daemon with a reverse proxy and nothing about pairing leaves their machine.
 *
 * The page is self-contained (inline CSS, inline SVG QR) and shows the code in
 * every form a person might need it: an "Open in FDE" deep link, a QR to scan
 * with a phone, and the raw code to type in by hand. An invalid, unknown, or
 * expired code renders one generic message and nothing else.
 */
import { buildPairingDeepLink } from "@fde/protocol/connection-offer";
import { escapeHtml, PAIRING_PAGE_STYLES } from "./pairing-page-chrome.js";

export const EXPIRED_PAIRING_MESSAGE = "This pairing link has expired";

export interface PairingCodePageInput {
  /** The offer payload, URL-safe base64, exactly as it appeared in the link. */
  code: string;
  hostname: string | null;
  /** Inline SVG markup of the QR for this link, or null when rendering failed. */
  qrSvg: string | null;
  /**
   * True when this daemon issued the code and the token is still live, so the
   * browser looking at the page can pair itself.
   */
  canPairThisBrowser: boolean;
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${PAIRING_PAGE_STYLES}</style>
</head>
<body>
<main>
  <div class="brand"><span class="dot"></span><b>FDE</b></div>
${body}
</main>
</body>
</html>
`;
}

/** The only thing an unknown, malformed, or expired code ever renders. */
export function renderExpiredPairingPage(): string {
  return shell(
    "FDE pairing",
    `  <h1>${EXPIRED_PAIRING_MESSAGE}</h1>
  <p>Pairing links are single-use and valid for a few minutes. Run <code>fde pair</code> on the machine running the daemon to get a new one.</p>`,
  );
}

const SCRIPT = `
(function(){
  var copy=document.getElementById('copy');
  if(copy){copy.addEventListener('click',function(){
    var code=document.getElementById('code').textContent;
    if(navigator.clipboard){navigator.clipboard.writeText(code).then(function(){copy.textContent='Copied';});}
  });}
  var pairHere=document.getElementById('pair-here');
  if(pairHere){pairHere.addEventListener('click',function(event){
    event.preventDefault();
    // The web UI runs the claim itself: it redeems the single-use token and
    // stores the returned credential as this host's password.
    location.href='/#offer='+document.body.dataset.code;
  });}
})();
`;

export function renderPairingCodePage(input: PairingCodePageInput): string {
  const code = escapeHtml(input.code);
  const deepLink = buildPairingDeepLink(`#offer=${input.code}`);
  const openInApp = deepLink
    ? `<a class="button" href="${escapeHtml(deepLink)}">Open in FDE</a>`
    : "";
  const pairHere = input.canPairThisBrowser
    ? `<button id="pair-here" type="button" class="secondary">Pair this browser</button>`
    : "";
  const qr = input.qrSvg
    ? `<div class="qr">${input.qrSvg}</div>`
    : `<p>QR rendering is unavailable; use the code below.</p>`;
  const host = input.hostname
    ? `<p>This link pairs a device with the FDE daemon on <span class="host">${escapeHtml(input.hostname)}</span>.</p>`
    : `<p>This link pairs a device with an FDE daemon.</p>`;

  return shell(
    "Pair with FDE",
    `  <h1>Pair with FDE</h1>
${host}
  ${qr}
  <ol>
    <li>On a phone: open the FDE app and scan the code above.</li>
    <li>On a computer with the FDE desktop app: <em>Open in FDE</em>.</li>
    <li>Or open the app, choose <em>Paste pairing link</em>, and paste the code below.</li>
  </ol>
  <p class="link" id="code">${code}</p>
  <div class="row">
    ${openInApp}
    ${pairHere}
    <button id="copy" type="button" class="secondary">Copy code</button>
  </div>
  <div class="meta">Pairing codes are single-use and expire after a few minutes. Treat this one like a password: anyone who has it can pair with the daemon.</div>
<script>${SCRIPT}</script>`,
  ).replace("<body>", `<body data-code="${code}">`);
}
