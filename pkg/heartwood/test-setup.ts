// Bun test preload (wired in bunfig.toml). config() (src/config.ts) throws when
// the four required secrets are missing. Locally they come from the gitignored
// .env, but CI and fresh clones have none — which makes any test that reaches
// config() fail with "Missing required env vars". Every unit test injects its
// LLM dependency (completeFn) and makes no real network calls, so dummy values
// are sufficient and keep the suite hermetic.
//
// Bun loads .env *before* running this preload, so `??=` only fills gaps and
// never clobbers a developer's real credentials. config.test.ts deletes these
// vars itself to exercise the missing-env path, so it is unaffected.
const TEST_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  GITLAB_TOKEN: 'glpat-test',
  GITLAB_PROJECT_ID: '0',
  GITLAB_URL: 'https://gitlab.example.com',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  Bun.env[key] ??= value;
}
