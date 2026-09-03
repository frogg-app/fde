/**
 * The "Claim this FDE daemon" page: what the web server serves instead of the
 * app while the daemon is unclaimed and reached from an untrusted address (public,
 * or the LAN with `daemon.auth.trustLan` off). It is
 * self-contained (inline CSS, inline SVG QR, no external assets) and polls
 * `/api/setup/status` until a device has paired, then reloads into the app.
 */
import { buildPairingDeepLink } from "@fde/protocol/connection-offer";

export const FDE_ACCENT = "#25B5C8";

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLES = `
:root{color-scheme:light dark;--accent:${FDE_ACCENT};--bg:#0f1417;--card:#161d21;--fg:#e6edf0;--muted:#8fa3ab;--border:#243036}
@media (prefers-color-scheme:light){:root{--bg:#f4f7f8;--card:#ffffff;--fg:#14202a;--muted:#5b6b73;--border:#d8e1e5}}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}
main{width:100%;max-width:520px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px 28px 22px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.brand .dot{width:12px;height:12px;border-radius:50%;background:var(--accent)}
.brand b{letter-spacing:.06em;font-size:13px;color:var(--accent)}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 12px;color:var(--muted)}
.host{color:var(--fg);font-weight:600}
.qr{display:flex;justify-content:center;background:#fff;border-radius:10px;padding:12px;margin:16px 0}
.qr svg{width:220px;height:220px}
ol{padding-left:20px;margin:0 0 14px;color:var(--fg)}ol li{margin:4px 0}
.link{display:block;word-break:break-all;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--fg);text-decoration:none}
.row{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
button,.button{display:inline-block;background:var(--accent);color:#04191d;border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.status{font-size:13px;color:var(--muted)}
.meta{margin-top:16px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:10px}
`;

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
<style>${STYLES}</style>
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
