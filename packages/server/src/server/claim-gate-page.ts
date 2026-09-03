/**
 * The "Claim this FDE daemon" page: what the web server serves instead of the
 * app while the daemon is unclaimed and reached from an untrusted address (public,
 * or the LAN with `daemon.auth.trustLan` off). It is
 * self-contained (inline CSS, inline SVG QR, no external assets) and polls
 * `/api/setup/status` until a device has paired, then reloads into the app.
 */
import { buildPairingDeepLink } from "@fde/protocol/connection-offer";
import { escapeHtml, FDE_ACCENT, PAIRING_PAGE_STYLES } from "./pairing-page-chrome.js";

export { FDE_ACCENT };

export interface ClaimGatePageInput {
  hostname: string;
  serverId: string;
  version: string;
  pairingUrl: string;
  /** Inline SVG markup of the pairing QR, or null when rendering failed. */
  qrSvg: string | null;
  expiresAt: string;
  endpoints: readonly string[];
}

const SCRIPT = `
(function(){
  var status=document.getElementById('status');
  var expiresAt=new Date(document.body.dataset.expiresAt).getTime();
  var copy=document.getElementById('copy');
  copy.addEventListener('click',function(){
    var link=document.getElementById('link').getAttribute('href');
    if(navigator.clipboard){navigator.clipboard.writeText(link).then(function(){copy.textContent='Copied';});}
  });
  document.getElementById('refresh').addEventListener('click',function(){location.reload();});
  function tick(){
    if(Date.now()>expiresAt){status.textContent='This pairing code expired. Refresh for a new one.';return;}
    fetch('/api/setup/status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){
      if(s&&s.claimed){status.textContent='Paired. Loading FDE…';setTimeout(function(){location.reload();},600);return;}
      var left=Math.max(0,Math.round((expiresAt-Date.now())/60000));
      status.textContent='Waiting for a device to pair… code valid for about '+left+' min.';
      setTimeout(tick,2000);
    }).catch(function(){status.textContent='Daemon unreachable, retrying…';setTimeout(tick,3000);});
  }
  tick();
})();
`;

export function renderClaimGatePage(input: ClaimGatePageInput): string {
  const url = escapeHtml(input.pairingUrl);
  const deepLink = buildPairingDeepLink(input.pairingUrl);
  const openInApp = deepLink
    ? `<a id="open-app" class="button" href="${escapeHtml(deepLink)}">Open in FDE app</a>`
    : "";
  const qr = input.qrSvg
    ? `<div class="qr">${input.qrSvg}</div>`
    : `<p>QR rendering is unavailable; use the link below.</p>`;
  const endpoints = input.endpoints.map((endpoint) => escapeHtml(endpoint)).join(", ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Claim this FDE daemon</title>
<style>${PAIRING_PAGE_STYLES}</style>
</head>
<body data-expires-at="${escapeHtml(input.expiresAt)}">
<main>
  <div class="brand"><span class="dot"></span><b>FDE</b></div>
  <h1>Claim this FDE daemon</h1>
  <p>This FDE daemon on <span class="host">${escapeHtml(input.hostname)}</span> has not been claimed yet. The first device that pairs becomes its owner.</p>
  ${qr}
  <ol>
    <li>On a phone, scan this code with the FDE app. On a computer with the FDE desktop app installed, <em>Open in FDE app</em> opens the link directly.</li>
    <li>Or open the app, choose <em>Paste pairing link</em>, and paste the link below.</li>
    <li>This page switches to FDE as soon as the device is paired.</li>
  </ol>
  <a id="link" class="link" href="${url}">${url}</a>
  <div class="row">
    ${openInApp}
    <button id="copy" type="button" class="secondary">Copy link</button>
    <button id="refresh" class="secondary" type="button">New code</button>
    <span id="status" class="status">Waiting for a device to pair…</span>
  </div>
  <div class="meta">Reachable at ${endpoints} · server ${escapeHtml(input.serverId)} · FDE ${escapeHtml(input.version)}. You are seeing this page because your address is not on the daemon's trusted private network (or <code>fde daemon trust-lan off</code> is set). On the daemon's own machine: <code>fde daemon pair</code>, <code>fde daemon set-password</code> to use a password instead, or <code>fde daemon trust-lan on</code> to let the local network in without pairing.</div>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
