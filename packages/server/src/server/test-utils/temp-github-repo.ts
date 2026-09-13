// Single namespace for temporary GitHub repos created by Frogg tests.
// Bulk cleanup relies on this prefix being unmistakable — never reuse `frogg-`
// (collides with real repos like `frogg`, `frogg-website`).
export const TEMP_GITHUB_REPO_PREFIX = "fdetmp-";

export function createTempGithubRepoName(category: string): string {
  const rand = Math.random().toString(16).slice(2, 8);
  return `${TEMP_GITHUB_REPO_PREFIX}${category}-${Date.now()}-${rand}`;
}
