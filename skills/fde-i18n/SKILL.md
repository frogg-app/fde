---
name: fde-i18n
description: Add, change, or translate user-facing UI copy in the FDE Expo client. Use when writing any new visible string in apps/ui, when the i18n resource parity test fails, when a locale file fails typecheck with a missing property, or when adding forge-variant (pull request / merge request) wording. Covers the nine locales, the type gate, and every invariant resources.test.ts enforces.
---

# Adding UI strings

Client copy lives in `apps/ui/src/i18n/resources/`: `en.ts` plus `ar`, `es`, `fr`, `ja`, `ko`,
`pt-BR`, `ru`, `zh-CN`. Resources are deeply nested objects grouped by product surface
(`common.actions.cancel`), not flat dotted keys.

**English is not a starting point you fill in later.** `en.ts` ends with

```ts
export type TranslationResources = WidenStringLeaves<typeof en>;
```

and every other locale is annotated `export const es: TranslationResources = { ... }`. Adding a
key to `en.ts` alone breaks the typecheck of all eight other locale files immediately. An extra
key in one locale is also a type error. There is no machine-translation script in this repo —
all nine locales are edited together, in one change, every time.

## What to translate

Client-owned copy: labels, buttons, empty states, confirmations, local status and error
wrappers. **Not** agent output, daemon output, terminal contents, file paths, provider or model
names, command names, user-authored text, code blocks, logs, or raw protocol/server error text.
Those stay as runtime values interpolated into a translated wrapper.

Group keys by product surface, not by component mechanics.

## The procedure

1. Add the key to `en.ts` under the surface that owns it.
2. Add the same key, translated, to all eight other locales. Do not paste English.
3. If the copy varies by git forge, see below.
4. Consume it: a React component or custom hook uses `const { t } = useTranslation()`. A pure
   helper, view-model, or policy module that is not a component or hook imports the instance and
   calls `i18n.t(...)` directly. That boundary is deliberate — do not add `useTranslation` to a
   low-level primitive like `<Button>` unless it owns the text it renders.
5. Verify:

```bash
npx vitest run apps/ui/src/i18n/resources.test.ts --bail=1
npm run typecheck --workspace=@fde/app
```

The workspace name for `apps/ui` is `@fde/app`. The parity test runs in about two seconds — run
it every time, not at the end.

## What resources.test.ts enforces

- **Key parity.** Flattened key list of every locale must equal English exactly. Missing or extra
  keys at any depth fail.
- **Fallback ratio.** Strings byte-identical to English must stay under 25% of the corpus per
  locale. A handful is harmless against ~3000 keys; bulk English-pasting a locale fails.
- **Interpolation parity.** The set of `{{placeholder}}` tokens per key must match English
  verbatim in every locale. Translating a placeholder _name_ fails.
- **Specific keys must be localized.** The pull-request empty state title and description are
  asserted to differ from English in every locale.
- **No hardcoded blocklisted English.** The test greps every non-test `.ts`/`.tsx` under
  `apps/ui/src` (outside `i18n/`) for a list of connection and load-failure phrases such as
  `"Daemon unavailable"` and `"Host is not connected"`. Writing one of those as a literal fails
  the test; use the resource key.
- **Per-batch value snapshots.** Roughly thirty assertions pin exact strings for previously
  migrated keys. New keys are unaffected, but **rewording an existing string breaks one of
  these** — update the assertion in the same change.

`plugin-settings.ts` is a separate per-locale block spread into each locale file. A key added
there needs an entry under all nine locale sub-objects too.

## Forge-variant copy

Two tiers, and picking the wrong one costs you a key per forge instead of a key per vocabulary
family.

- **Indeclinable tokens** — brand names, the `PR`/`MR` initialism, the `#`/`!` number prefix —
  are interpolated into a single key: `"Refresh git and {{brand}} state"`. They stay latin and
  uninflected in every locale, so one string per locale suffices.
- **Sentences containing the full noun** ("pull request" / "merge request" inflects and takes
  gender and case) use the i18next `context` mechanism: a base key carrying the pull-request
  wording plus an `_mr` sibling (`pullRequest` / `pullRequest_mr`). Call sites pass
  `t(key, { context: getForgePresentation(forge).changeRequestContext })`, which is `"mr"` or
  `undefined`; an unknown context falls back to the base key.

`getForgePresentation` lives in `apps/ui/src/git/forge.ts`. An `_mr` sibling is a real key: it
must exist in all nine locales or key parity fails.

## Adding a whole new locale

Much heavier than adding a string, and easy to half-do. Beyond a full resource file, the code
must be listed in: the `SupportedLocale` union, `LANGUAGE_OPTIONS`, `SUPPORTED_LANGUAGES`,
`LANGUAGE_NATIVE_NAMES`, and the N×N `LANGUAGE_NAMES_BY_LOCALE` matrix (every existing locale
needs a name for the new one) — all in `apps/ui/src/i18n/locales.ts`, plus
`REGIONAL_LANGUAGE_LOCALES` and any special case in `resolveSupportedLocale`; the `resources`
map in `apps/ui/src/i18n/i18next.ts`; the persisted `language` zod enum in
`apps/ui/src/hooks/use-settings/storage.ts`; the `settings.general.language.options.*` label
keys in every resource; `plugin-settings.ts`; and the expectations in
`apps/ui/src/i18n/locales.test.ts`.

See [docs/i18n.md](../../docs/i18n.md) for the migration batch log and scope rules.
