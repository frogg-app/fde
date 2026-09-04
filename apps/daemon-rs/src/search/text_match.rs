//! Ranked text matching, ported from `packages/protocol/src/search/text-match.ts`.
//!
//! A match is a tier plus the offset it was found at; lower is better on both,
//! so callers sort ascending. This is the scoring core the daemon's directory
//! suggestions and history search share with the app's pickers, so it has to
//! rank *identically* - a different order is a visible behaviour change.
//!
//! Offsets are UTF-16 code unit indices, matching JavaScript's string indexing,
//! because they are handed back to the client to highlight ranges. Working in
//! Rust `char`s would silently disagree on any path containing an emoji.

/// Exact tiers, best to worst. The fuzzy tier always sorts after all of them.
const TIER_EXACT: i64 = 0;
const TIER_WHOLE_WORD: i64 = 1;
const TIER_PREFIX: i64 = 2;
const TIER_WORD_START: i64 = 3;
const TIER_SUBSTRING: i64 = 4;
const TIER_SUBSEQUENCE: i64 = 5;
const TIER_FUZZY: i64 = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MatchScore {
    pub tier: i64,
    pub offset: i64,
    /// Absent in the TypeScript original; `None` and `Some(0)` are distinct
    /// there only in `scoreTextFields`, which falls back to the token length.
    pub spread: Option<i64>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct MatchOptions {
    pub fuzzy: Option<FuzzyPolicy>,
    /// Defaults to on. Off means a near miss reads as no match at all.
    pub subsequence: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FuzzyPolicy {
    pub max_edits: i64,
    pub transpositions_only: bool,
}

/// UTF-16 view of a string, so indices match JavaScript's.
type Units = Vec<u16>;

fn units(value: &str) -> Units {
    value.encode_utf16().collect()
}

fn lower_units(value: &str) -> Units {
    units(&value.to_lowercase())
}

/// The TypeScript uses `/[a-z0-9]/` against already-lowercased text, so this is
/// deliberately ASCII-only: any other character is a word boundary.
fn is_ascii_alnum(unit: u16) -> bool {
    matches!(unit, 0x30..=0x39 | 0x61..=0x7a)
}

fn is_word_boundary(unit: Option<u16>) -> bool {
    match unit {
        None => true,
        Some(unit) => !is_ascii_alnum(unit),
    }
}

fn index_of(haystack: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return Some(from.min(haystack.len()));
    }
    if needle.len() > haystack.len() {
        return None;
    }
    (from..=haystack.len().saturating_sub(needle.len()))
        .find(|&start| &haystack[start..start + needle.len()] == needle)
}

fn score_substring_match(query: &[u16], text: &[u16]) -> Option<MatchScore> {
    let mut best: Option<MatchScore> = None;
    let mut pos = 0usize;
    while text.len() >= query.len() && pos <= text.len() - query.len() {
        let Some(found) = index_of(text, query, pos) else {
            break;
        };
        let before = if found > 0 {
            Some(text[found - 1])
        } else {
            None
        };
        let after = text.get(found + query.len()).copied();
        let starts_at_boundary = found == 0 || is_word_boundary(before);
        let ends_at_boundary = after.is_none() || is_word_boundary(after);

        let tier = if starts_at_boundary && ends_at_boundary {
            TIER_WHOLE_WORD
        } else if found == 0 {
            TIER_PREFIX
        } else if starts_at_boundary {
            TIER_WORD_START
        } else {
            TIER_SUBSTRING
        };

        let found = found as i64;
        if best.map_or(true, |b| {
            tier < b.tier || (tier == b.tier && found < b.offset)
        }) {
            best = Some(MatchScore {
                tier,
                offset: found,
                spread: None,
            });
        }
        pos = found as usize + 1;
    }
    best
}

fn score_subsequence_match(query: &[u16], text: &[u16]) -> Option<MatchScore> {
    let mut query_index = 0usize;
    let mut first: Option<usize> = None;
    let mut last = 0usize;
    for (text_index, unit) in text.iter().enumerate() {
        if query_index >= query.len() {
            break;
        }
        if *unit != query[query_index] {
            continue;
        }
        if first.is_none() {
            first = Some(text_index);
        }
        last = text_index;
        query_index += 1;
    }
    let first = first?;
    if query_index != query.len() {
        return None;
    }
    Some(MatchScore {
        tier: TIER_SUBSEQUENCE,
        offset: first as i64,
        spread: Some((last - first + 1) as i64),
    })
}

/// Damerau-Levenshtein, abandoned as soon as every cell in a row is over
/// budget. Bounding it is what keeps the fuzzy tier affordable per candidate.
fn bounded_edit_distance(query: &[u16], word: &[u16], budget: i64) -> Option<i64> {
    if (query.len() as i64 - word.len() as i64).abs() > budget {
        return None;
    }

    let mut two_rows_back: Vec<i64> = Vec::new();
    let mut previous_row: Vec<i64> = (0..=word.len() as i64).collect();

    for query_index in 1..=query.len() {
        let mut current_row = vec![query_index as i64];
        let mut row_best = query_index as i64;
        for word_index in 1..=word.len() {
            let substitution_cost = i64::from(query[query_index - 1] != word[word_index - 1]);
            let mut cost = (current_row[word_index - 1] + 1)
                .min(previous_row[word_index] + 1)
                .min(previous_row[word_index - 1] + substitution_cost);
            let is_transposition = query_index > 1
                && word_index > 1
                && query[query_index - 1] == word[word_index - 2]
                && query[query_index - 2] == word[word_index - 1];
            if is_transposition {
                cost = cost.min(two_rows_back[word_index - 2] + 1);
            }
            current_row.push(cost);
            row_best = row_best.min(cost);
        }
        if row_best > budget {
            return None;
        }
        two_rows_back = previous_row;
        previous_row = current_row;
    }

    let distance = previous_row[word.len()];
    (distance <= budget).then_some(distance)
}

/// True when the two differ only by one swap of neighbouring characters.
fn is_adjacent_transposition(query: &[u16], word: &[u16]) -> bool {
    if query.len() != word.len() {
        return false;
    }
    let mut index = 0usize;
    while index < query.len() && query[index] == word[index] {
        index += 1;
    }
    if index + 1 >= query.len() {
        return false;
    }
    if query[index] != word[index + 1] || query[index + 1] != word[index] {
        return false;
    }
    query[index + 2..] == word[index + 2..]
}

/// How much a typo in one token is forgiven. Short tokens get transpositions
/// only: at four characters a free substitution turns "main" into "mail",
/// "maid" and "rain", while a swap can only reach the word the user meant.
pub fn fuzzy_policy_for_token(token: &str) -> Option<FuzzyPolicy> {
    let length = units(token).len();
    match length {
        0..=3 => None,
        4 => Some(FuzzyPolicy {
            max_edits: 1,
            transpositions_only: true,
        }),
        5..=7 => Some(FuzzyPolicy {
            max_edits: 1,
            transpositions_only: false,
        }),
        _ => Some(FuzzyPolicy {
            max_edits: 2,
            transpositions_only: false,
        }),
    }
}

/// ASCII word spans, matching the TypeScript's `/[a-z0-9]+/g` over lowercased text.
fn ascii_words(text: &[u16]) -> Vec<(usize, &[u16])> {
    let mut words = Vec::new();
    let mut start: Option<usize> = None;
    for index in 0..=text.len() {
        let alnum = index < text.len() && is_ascii_alnum(text[index]);
        match (alnum, start) {
            (true, None) => start = Some(index),
            (false, Some(begin)) => {
                words.push((begin, &text[begin..index]));
                start = None;
            }
            _ => {}
        }
    }
    words
}

/// Words are what people mistype, so the fuzzy tier compares the query against
/// each word rather than the whole string.
fn score_fuzzy_match(query: &[u16], text: &[u16], policy: FuzzyPolicy) -> Option<MatchScore> {
    if policy.max_edits <= 0 || query.len() as i64 <= policy.max_edits {
        return None;
    }

    let mut best: Option<MatchScore> = None;
    for (offset, word) in ascii_words(text) {
        // The whole word and its leading slices, so a typo in a prefix
        // ("confug" for "configuration") still lands - the length gap to the
        // full word would otherwise blow the budget on its own.
        let mut candidates: Vec<&[u16]> = vec![word];
        for take in [query.len(), query.len() + policy.max_edits as usize] {
            let slice = &word[..take.min(word.len())];
            if !candidates.contains(&slice) {
                candidates.push(slice);
            }
        }

        for candidate in candidates {
            let distance = if policy.transpositions_only {
                is_adjacent_transposition(query, candidate).then_some(1)
            } else {
                bounded_edit_distance(query, candidate, policy.max_edits)
            };
            let Some(distance) = distance else { continue };
            let score = MatchScore {
                tier: TIER_FUZZY,
                offset: offset as i64,
                spread: Some(distance),
            };
            if best.map_or(true, |b| compare_match_scores(&score, &b) < 0) {
                best = Some(score);
            }
        }
    }
    best
}

pub fn score_match(query: &str, text: &str, options: MatchOptions) -> Option<MatchScore> {
    if query.is_empty() {
        return Some(MatchScore {
            tier: TIER_EXACT,
            offset: 0,
            spread: None,
        });
    }
    let q = lower_units(query);
    let t = lower_units(text);
    if t == q {
        return Some(MatchScore {
            tier: TIER_EXACT,
            offset: 0,
            spread: None,
        });
    }

    let substring = score_substring_match(&q, &t);
    let exact = substring.or_else(|| {
        if options.subsequence == Some(false) {
            None
        } else {
            score_subsequence_match(&q, &t)
        }
    });
    if exact.is_some() {
        return exact;
    }

    options
        .fuzzy
        .and_then(|policy| score_fuzzy_match(&q, &t, policy))
}

struct CompactText {
    value: String,
    offsets: Vec<usize>,
}

/// Strips everything but ASCII alphanumerics, remembering where each survivor
/// came from so an offset can be mapped back to the original string.
fn compact_text(value: &str) -> CompactText {
    let raw = units(value);
    let mut compact = String::new();
    let mut offsets = Vec::new();
    for (index, unit) in raw.iter().enumerate() {
        let ch = char::from_u32(u32::from(*unit));
        let Some(ch) = ch else { continue };
        if !ch.is_ascii_alphanumeric() {
            continue;
        }
        compact.push(ch.to_ascii_lowercase());
        offsets.push(index);
    }
    CompactText {
        value: compact,
        offsets,
    }
}

/// Match a query against a complete displayed path, including its separators.
pub fn score_path_match(query: &str, path: &str) -> Option<MatchScore> {
    if let Some(direct) = score_match(query, path, MatchOptions::default()) {
        return Some(direct);
    }

    let compact_query = compact_text(query);
    let compact_path = compact_text(path);
    if compact_query.value.is_empty() || compact_path.value.is_empty() {
        return None;
    }

    let compact_score = score_match(
        &compact_query.value,
        &compact_path.value,
        MatchOptions::default(),
    )?;
    let mapped = compact_path
        .offsets
        .get(compact_score.offset as usize)
        .map(|offset| *offset as i64)
        .unwrap_or(compact_score.offset);
    Some(MatchScore {
        offset: mapped,
        ..compact_score
    })
}

pub fn compare_match_scores(a: &MatchScore, b: &MatchScore) -> i64 {
    if a.tier != b.tier {
        return a.tier - b.tier;
    }
    if a.offset != b.offset {
        return a.offset - b.offset;
    }
    a.spread.unwrap_or(0) - b.spread.unwrap_or(0)
}

pub fn tokenize_query(query: &str) -> Vec<String> {
    query
        .trim()
        .to_lowercase()
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .collect()
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TextFieldsOptions {
    pub typo_tolerant: bool,
    pub subsequence: Option<bool>,
}

pub fn score_text_fields(
    query: &str,
    fields: &[String],
    options: TextFieldsOptions,
) -> Option<MatchScore> {
    let tokens = tokenize_query(query);
    if tokens.is_empty() {
        return Some(MatchScore {
            tier: TIER_EXACT,
            offset: 0,
            spread: Some(0),
        });
    }

    let mut aggregate = MatchScore {
        tier: TIER_EXACT,
        offset: 0,
        spread: Some(0),
    };
    for token in &tokens {
        let fuzzy = options
            .typo_tolerant
            .then(|| fuzzy_policy_for_token(token))
            .flatten();
        let mut best: Option<MatchScore> = None;
        for field in fields {
            let score = score_match(
                token,
                field,
                MatchOptions {
                    fuzzy,
                    subsequence: options.subsequence,
                },
            );
            if let Some(score) = score {
                if best.map_or(true, |b| compare_match_scores(&score, &b) < 0) {
                    best = Some(score);
                }
            }
        }
        let best = best?;
        aggregate.tier += best.tier;
        aggregate.offset += best.offset;
        // A missing spread falls back to the token length, not zero.
        aggregate.spread =
            Some(aggregate.spread.unwrap_or(0) + best.spread.unwrap_or(units(token).len() as i64));
    }
    Some(aggregate)
}
