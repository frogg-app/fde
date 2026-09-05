---
name: fde-rpc
description: Add or change a WebSocket session RPC between the FDE daemon and its clients. Use when adding a new request/response message, wiring a daemon handler, exposing a new daemon capability to the app, gating a feature on `server_info.features`, or when a protocol change fails typecheck, the authorization exhaustiveness test, or the generated-Rust staleness check. Covers the exact ordered file list and the traps.
---

# Adding a session RPC

Twelve files in a fixed order. Skipping one usually surfaces as a typecheck error in an
unrelated package or a CI job that fails on generated artifacts, so follow the order.

Read [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md) and
[docs/protocol-compatibility.md](../../docs/protocol-compatibility.md) before designing the
message. The rules that bite:

- Dotted names, direction last: `checkout.forge.set_auto_merge.request` / `.response`. Never add
  a new flat snake_case name.
- The operation segment is a verb. `get_noun.request`, never `noun.request`.
- Requests are flat with `cwd` and `requestId` at top level. Responses put everything under
  `payload`, including `requestId` and a nullable `error`.
- The response type must be exactly the request type with `.request` → `.response`. The client
  helper derives it by string replacement; a mismatch is unfixable without a bespoke call path.
- New fields are `.optional()`. Never flip optional to required, remove a field, or narrow a
  type — an app six months old still has to parse your message.
- Wire schemas are pure: no `.transform()`, `.catch()`, or `.preprocess()`. The outbound
  validator is compiled ahead of time and the generator only compiles pure schemas.
- `z.discriminatedUnion`, never `z.union`, when branches share a literal tag.

Use `checkout.forge.set_auto_merge.*` as the worked example; every step below has a real line
you can copy from.

## Ordered checklist

Everything in steps 1–5 is `packages/protocol/src/messages.ts`.

1. **Request schema** — in the section for your domain (checkout requests sit around line 2230).
2. **Response schema** — the matching response section (around line 5290).
3. **Inferred types** — `export type X = z.infer<typeof XSchema>` for both. The client imports
   these; without them there is no payload type to alias.
4. **`SessionInboundMessageSchema`** — add the request schema const to the discriminated union.
5. **`SessionOutboundMessageSchema`** — add the response schema const. `WSInboundMessageSchema`
   and `WSOutboundMessageSchema` wrap the session unions and need no edit.
6. **Capability flag**, if the app must gate on it — add
   `<flagName>: z.boolean().optional()` to `features` on `ServerInfoStatusPayloadSchema`, with a
   `// COMPAT(<name>): added in vX.Y.Z, remove after <date>` comment.
7. **Permissions** — `packages/server/src/server/authorization/operation-permissions.ts`. Add the
   request to `INBOUND_PERMISSION` and the response to `OUTBOUND_PERMISSION`, keeping the
   alphabetical order. Both tables end in `as const satisfies Record<...Operation, ...>`, so a
   missing key is a typecheck failure, not a runtime one.
8. **Handler** — the domain session file, e.g.
   `packages/server/src/server/session/checkout/checkout-session.ts`. Handlers take
   `Extract<SessionInboundMessage, { type: "ns.x.request" }>`, return `Promise<void>`, and
   **emit** the response. They never return it.
9. **Dispatch** — `packages/server/src/server/session.ts`. Add a `case` to the
   `dispatchXxxMessage` switch for your domain (`dispatchCheckoutMessage` is around line 2419).
   `dispatchInboundMessage` chains those with `??`; each switch has `default: return undefined`.
10. **Advertise the capability** — `buildServerInfoStatusPayload` in
    `packages/server/src/server/websocket-server.ts`. A flag means the running daemon can
    actually perform the action, not merely that a handler exists; conditional flags use
    `...(cond ? { flag: true } : {})`.
11. **Client method** — `packages/client/src/daemon-client.ts`: import the response type, add a
    `type XPayload = XResponse["payload"]` alias, then a public async method calling
    `this.sendNamespacedCorrelatedSessionRequest<"ns.x.response">({ requestId, message, timeout })`.
    Dotted names get response-type derivation for free here.
12. **Call site** — gate on the capability in exactly one place
    (`session?.serverInfo?.features?.<flag> === true`) and let everything downstream read a clean
    shape. No fallback path for old daemons; the user updates or does not get the feature.

Then tests: the handler test beside the handler, the dispatch-routing test in
`packages/server/src/server/session.test.ts` (which also holds a stub interface listing handler
names — add yours or the fake stops satisfying its type), and the feature-gate test beside the
call site.

## Regenerate the derived artifacts

zod is the source of truth; three artifacts are derived from it and CI fails if they are stale.

```bash
npm run build --workspace=@fde/protocol   # postbuild regenerates the Rust types and fixtures
bash scripts/ci/check-generated-rust.sh   # the exact CI gate
```

Commit the resulting changes under `packages/protocol/generated/` and
`apps/daemon-rs/src/generated/`. Leaving them out is the most common CI failure on a protocol
change — the Rust daemon's view of the wire format silently diverges from every TypeScript
client's.

The ahead-of-time outbound validator
(`packages/protocol/src/generated/validation/ws-outbound.aot.ts`) is gitignored and regenerated
by `pretypecheck`/`pretest`/`prebuild` in `@fde/protocol`. `@fde/client` has no such hook, so
run `npm run generate:validators --workspace=@fde/protocol` before testing the client — a stale
validator makes the client silently reject your new response frame.

## Verify

```bash
npm run typecheck:server    # relay → protocol → client → server → cli; cheapest gate that
                            # catches missing permission keys and client type drift
npx vitest run packages/server/src/server/authorization/index.test.ts --bail=1
npx vitest run packages/server/src/server/session/checkout/checkout-session.test.ts --bail=1
npm run test --workspace=@fde/protocol
bash scripts/ci/check-generated-rust.sh
```

The authorization test enumerates `SessionInboundMessageSchema.options` and asserts every
operation has a permission — that is the exhaustiveness gate that catches a union entry with no
permission row.

If a downstream package reports that a field you just added does not exist, the schema is fine
and `client` is compiled against the old protocol `dist/`. Run `npm run build:client`.

## Shims

Every back-compat shim carries `// COMPAT(name): added in vX.Y.Z, remove after <date>` at the
site that has to be deleted. `rg "COMPAT\("` is the cleanup backlog; an untagged `??` fallback
never gets removed because nobody can find it.
