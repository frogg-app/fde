//! Checks the Rust matcher against fixtures generated from the TypeScript one.
//!
//! Hand-written tests on both sides would agree by construction. These are
//! produced by running `packages/protocol/src/search/text-match.ts` over 13k
//! generated inputs, so a divergence in ranking shows up as a failure here
//! rather than as a differently-ordered picker in front of a user.

#[cfg(test)]
mod tests {
    use super::super::text_match::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct Expected {
        tier: i64,
        offset: i64,
        #[serde(default)]
        spread: Option<i64>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        kind: String,
        query: String,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        fields: Option<Vec<String>>,
        #[serde(default)]
        subsequence: Option<bool>,
        #[serde(default)]
        fuzzy: Option<FuzzyFixture>,
        #[serde(default)]
        typo_tolerant: Option<bool>,
        expected: Option<Expected>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FuzzyFixture {
        max_edits: i64,
        transpositions_only: bool,
    }

    #[derive(Debug, Deserialize)]
    struct PolicyCase {
        token: String,
        policy: Option<FuzzyFixture>,
    }

    #[derive(Debug, Deserialize)]
    struct TokenizationCase {
        query: String,
        tokens: Vec<String>,
    }

    #[derive(Debug, Deserialize)]
    struct OrderingCase {
        query: String,
        ranked: Vec<String>,
    }

    #[derive(Debug, Deserialize)]
    struct Fixtures {
        tokenizations: Vec<TokenizationCase>,
        policies: Vec<PolicyCase>,
        cases: Vec<Case>,
        orderings: Vec<OrderingCase>,
    }

    fn fixtures() -> Fixtures {
        let raw = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/protocol/generated/text-match-fixtures.json"
        ));
        serde_json::from_str(raw).expect("fixtures should parse")
    }

    fn same(actual: Option<MatchScore>, expected: &Option<Expected>) -> bool {
        match (actual, expected) {
            (None, None) => true,
            (Some(actual), Some(expected)) => {
                actual.tier == expected.tier
                    && actual.offset == expected.offset
                    // JS omits `spread` where Rust carries None; compare as 0.
                    && actual.spread.unwrap_or(0) == expected.spread.unwrap_or(0)
            }
            _ => false,
        }
    }

    #[test]
    fn matches_the_typescript_implementation_on_every_fixture() {
        let fixtures = fixtures();
        assert!(fixtures.cases.len() > 10_000, "fixture set looks truncated");

        let mut failures = Vec::new();
        for case in &fixtures.cases {
            let fuzzy = case.fuzzy.as_ref().map(|f| FuzzyPolicy {
                max_edits: f.max_edits,
                transpositions_only: f.transpositions_only,
            });
            let actual = match case.kind.as_str() {
                "scoreMatch" => score_match(
                    &case.query,
                    case.text.as_deref().unwrap_or_default(),
                    MatchOptions {
                        fuzzy,
                        subsequence: case.subsequence,
                    },
                ),
                "scorePathMatch" => {
                    score_path_match(&case.query, case.text.as_deref().unwrap_or_default())
                }
                "scoreTextFields" => score_text_fields(
                    &case.query,
                    case.fields.as_deref().unwrap_or_default(),
                    TextFieldsOptions {
                        typo_tolerant: case.typo_tolerant.unwrap_or(false),
                        subsequence: case.subsequence,
                    },
                ),
                other => panic!("unknown fixture kind {other}"),
            };

            if !same(actual, &case.expected) {
                failures.push(format!(
                    "{} query={:?} text={:?} fields={:?} fuzzy={:?}\n    rust={:?}\n    ts  ={:?}",
                    case.kind,
                    case.query,
                    case.text,
                    case.fields,
                    case.fuzzy,
                    actual,
                    case.expected
                ));
            }
        }

        assert!(
            failures.is_empty(),
            "{} of {} fixtures diverged:\n{}",
            failures.len(),
            fixtures.cases.len(),
            failures
                .iter()
                .take(10)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        );
    }

    #[test]
    fn tokenizes_identically() {
        for case in fixtures().tokenizations {
            assert_eq!(
                tokenize_query(&case.query),
                case.tokens,
                "query {:?}",
                case.query
            );
        }
    }

    #[test]
    fn picks_the_same_fuzzy_policy() {
        for case in fixtures().policies {
            let actual = fuzzy_policy_for_token(&case.token);
            match (actual, &case.policy) {
                (None, None) => {}
                (Some(actual), Some(expected)) => {
                    assert_eq!(
                        actual.max_edits, expected.max_edits,
                        "token {:?}",
                        case.token
                    );
                    assert_eq!(
                        actual.transpositions_only, expected.transpositions_only,
                        "token {:?}",
                        case.token
                    );
                }
                _ => panic!(
                    "policy mismatch for {:?}: {actual:?} vs {:?}",
                    case.token, case.policy
                ),
            }
        }
    }

    #[test]
    fn ranks_candidates_in_the_same_order() {
        // The property that actually matters: these scores exist to sort.
        for case in fixtures().orderings {
            let mut scored: Vec<(String, MatchScore)> = case
                .ranked
                .iter()
                .filter_map(|path| score_path_match(&case.query, path).map(|s| (path.clone(), s)))
                .collect();
            scored.sort_by(|a, b| compare_match_scores(&a.1, &b.1).cmp(&0));
            let ranked: Vec<String> = scored.into_iter().map(|(path, _)| path).collect();
            assert_eq!(
                ranked, case.ranked,
                "ordering diverged for query {:?}",
                case.query
            );
        }
    }
}
