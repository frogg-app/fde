//! Types generated from the zod protocol schema.
//!
//! Regenerate with `npm run generate:rust --workspace=@fde/protocol`. CI fails
//! if these are stale, so the Rust and TypeScript views of the wire format
//! cannot drift.

pub mod inbound;
pub mod outbound;
