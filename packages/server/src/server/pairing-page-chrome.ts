import { brand } from "@frogg/branding";
/**
 * Shared chrome for the daemon's two self-contained HTML pages: the "Claim
 * this Frogg daemon" gate and the `/code/<code>` pairing landing page. Inline
 * CSS only — these pages load no external assets.
 */
export const FROGG_ACCENT = brand.colors.dark.accent;

/** Where `GET /` sends a visitor who arrives without a pairing code. */
export const DEFAULT_PAIR_PAGE_ROOT_REDIRECT = brand.links.website ?? "";

/**
 * The pages are self-contained (inline CSS, inline SVG QR, one inline script)
 * and load nothing from anywhere, so everything else can be denied. Lives here
 * so the express service and the Cloudflare Worker ship the same policy.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const PAIRING_PAGE_STYLES = `
:root{color-scheme:light dark;--accent:${brand.colors.dark.accent};--accent-fg:${brand.colors.dark.accentForeground};--bg:${brand.colors.dark.background};--card:${brand.colors.dark.background};--fg:${brand.colors.dark.foreground};--muted:${brand.colors.dark.foreground};--border:#52616b}
@media (prefers-color-scheme:light){:root{--accent:${brand.colors.light.accent};--accent-fg:${brand.colors.light.accentForeground};--bg:${brand.colors.light.background};--card:${brand.colors.light.background};--fg:${brand.colors.light.foreground};--muted:${brand.colors.light.foreground};--border:#c0c9cf}}
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
button,.button{display:inline-block;background:var(--accent);color:var(--accent-fg);border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.status{font-size:13px;color:var(--muted)}
.meta{margin-top:16px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:10px}
`;
