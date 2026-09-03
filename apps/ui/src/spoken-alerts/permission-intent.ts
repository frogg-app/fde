/**
 * What a short spoken reply to a permission request means. Anything that is not clearly a
 * yes or a no, or that is long enough to be an actual message, is ambiguous and needs the
 * user to confirm before it is sent as a decision.
 */
export type VoicePermissionIntent = { kind: "allow" } | { kind: "deny" } | { kind: "ambiguous" };

const MAX_DECISION_WORDS = 6;

const ALLOW_PHRASES = [
  "yes",
  "yeah",
  "yep",
  "yup",
  "sure",
  "ok",
  "okay",
  "approve",
  "approved",
  "allow",
  "allowed",
  "accept",
  "accepted",
  "confirm",
  "confirmed",
  "proceed",
  "go ahead",
  "go for it",
  "do it",
  "fine",
  "alright",
  "all right",
  "affirmative",
  "sounds good",
];

const DENY_PHRASES = [
  "no",
  "nope",
  "nah",
  "deny",
  "denied",
  "reject",
  "rejected",
  "decline",
  "declined",
  "refuse",
  "stop",
  "cancel",
  "never",
  "negative",
  "don't",
  "dont",
  "do not",
  "not now",
];

function normalizeTranscript(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

export function resolveVoicePermissionIntent(transcript: string): VoicePermissionIntent {
  const text = normalizeTranscript(transcript);
  if (text.length === 0) return { kind: "ambiguous" };
  if (text.split(" ").length > MAX_DECISION_WORDS) return { kind: "ambiguous" };

  const allows = ALLOW_PHRASES.some((phrase) => containsPhrase(text, phrase));
  const denies = DENY_PHRASES.some((phrase) => containsPhrase(text, phrase));
  if (allows && !denies) return { kind: "allow" };
  if (denies && !allows) return { kind: "deny" };
  return { kind: "ambiguous" };
}
