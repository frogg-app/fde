//! Search and ranking, shared with the TypeScript protocol package.
//!
//! Ported ahead of its consumer: the directory-suggestions handler is the next
//! stage, and porting the pure scoring core first is what makes that port
//! checkable against the TypeScript one. Until then the public surface is
//! exercised only by the conformance tests, hence the allow.
#![allow(dead_code)]

pub mod text_match;
mod text_match_conformance;
