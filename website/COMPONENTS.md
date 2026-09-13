# Docs components

Import everything from one place in any `.mdx` page under `src/content/docs/docs/`:

```mdx
import { Screenshot, Terminal, BrandPreview, Steps, Aside, Tabs, TabItem } from "@/components/docs";
```

## `<Screenshot>`

Rounded, shadowed image with click-to-zoom (Esc or click to close; focus returns to the image).
Images are optimised to responsive WebP at build time, so import them rather than using strings.

```mdx
import pairing from "@/assets/docs/getting-started/pairing.png";
import pairingLight from "@/assets/docs/getting-started/pairing-light.png";

<Screenshot src={pairing} alt="Pairing dialog showing a QR code" caption="Scan from your phone." />
<Screenshot src={pairing} lightSrc={pairingLight} alt="…" width={420} variant="bare" />
```

| Prop       | Type                       | Notes                                                        |
| ---------- | -------------------------- | ------------------------------------------------------------ |
| `src`      | imported image or URL      | Required. Shown in dark theme (and light, unless `lightSrc`). |
| `alt`      | string                     | Required. Describe what the reader should notice.            |
| `caption`  | string                     | Optional, rendered under the image.                          |
| `lightSrc` | imported image or URL      | Optional variant shown in light theme.                       |
| `width`    | number (CSS px)            | Optional max width, e.g. for phone screenshots.              |
| `variant`  | `"frame"` (default) `"bare"` | `bare` drops the hairline border.                          |

Screenshots live in `src/assets/docs/**`.

## `<Terminal>`

Terminal-styled command block with a copy button ("Copied" confirmation, screen-reader announced).

```mdx
<Terminal code="curl -fsSL https://frogg.app/install.sh | bash" />
<Terminal title="On the host" code={["frogg daemon status", "# comments are not copied", "frogg daemon pair"]} output="…" />
<Terminal title="PowerShell" prompt=">" code="frogg --version" />
```

| Prop     | Type                 | Notes                                                    |
| -------- | -------------------- | -------------------------------------------------------- |
| `code`   | string or string[]   | Required. One command per line; only these are copied.   |
| `title`  | string               | Bar label. Default `Terminal`.                           |
| `output` | string or string[]   | Dimmed output lines; never copied.                       |
| `prompt` | string               | Default `$`; `""` hides it. Prompts are never copied.     |

For code that is not a shell session, use a normal fenced code block (Expressive Code, also has copy).

## `<BrandPreview>`

Interactive rebranding playground: presets, app name/publisher/port, accent/background/foreground for
light and dark, live mock app window, contrast checks, reserved-identity warnings, copy/download of a
schema-valid `brand.json` (`packages/branding/brand.schema.json`). No props required.

```mdx
<BrandPreview />
<BrandPreview name="Acme Studio" publisher="Acme" />
```

## Starlight built-ins (re-exported)

`Steps`, `Aside` (note/tip/caution/danger; used instead of a custom Callout), `Tabs`/`TabItem`,
`Card`/`CardGrid`, `LinkCard`, `LinkButton`, `FileTree`, `Badge`, `Icon`.
See https://starlight.astro.build/components/using-components/.

## Conventions

- Sidebar: each top-level folder is a group; order pages with frontmatter `sidebar: { order: N }`.
- Links: use root-relative paths with a trailing slash, e.g. `/docs/self-hosting/install/`.
  `npm run linkcheck` (after `npm run build`) fails on broken internal links.
- Files or folders starting with `_` are ignored by the docs loader.
