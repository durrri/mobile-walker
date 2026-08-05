# GitHub validation

GitHub Actions carries repeatable validation so Codex can focus on implementation, focused local inspection, and preparing PRs without spending execution tokens on broad repeated compute.

## Merge-blocking PR CI

`CI` runs on every pull request and is intended to stay fast enough to be required for normal PRs:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `git diff --check`

The CI job also writes an informational build-size summary after the production build. No size budget is enforced yet; the current reported size should be treated as the initial baseline for future comparison.

`CodeQL` also runs on pull requests for JavaScript/TypeScript analysis when GitHub Advanced Security/CodeQL is available for the repository plan. Its result can be made merge-blocking in branch protection if supported.

## Manual extended validation

Run **Extended validation** from the Actions tab when a PR needs the expensive river checks:

```sh
npm run test:extended
```

This workflow uses Node 22, `npm ci`, npm caching, a 30-minute timeout, a GitHub job summary, and an uploaded log artifact. It does not run automatically on every PR.

## Manual base-versus-head river benchmarks

Run **River benchmark** from the Actions tab for `npm run benchmark:river`.

- To benchmark only the selected branch or commit, leave `compare_ref` empty.
- To compare a base and head on the same runner, run the workflow on the head branch or commit and set `compare_ref` to the base branch, tag, or SHA.

The selected GitHub ref is always the benchmark head. When `compare_ref` is empty, only that head ref is benchmarked. When `compare_ref` is supplied, the workflow resolves it, fails clearly if it cannot be fetched, and creates a separate Git worktree for the base. Each source tree runs its own `npm ci`, so dependencies and generated files do not contaminate the other measurement. The job summary shows the resolved base and head SHAs, and raw benchmark logs are uploaded as artifacts.

GitHub runner timings are useful mainly for same-run base-versus-head comparisons. They should not be treated as exact long-term absolute performance measurements, and no fragile hard merge threshold is enforced yet.

## Manual repeated invariant validation

Run **Repeated invariants** from the Actions tab to repeatedly execute deterministic and lifecycle-focused existing Vitest files:

```sh
npm run test:repeatable
```

The workflow accepts a repetition count input. The default is 10 and the maximum is 50. It fails immediately on the first failing repetition and reports the repetition number in the log.

The script currently covers existing tests for streaming lifecycle, cache reuse, disposal-adjacent repository behavior, generation-order independence, seams, and river ownership. It intentionally invokes existing Vitest files rather than duplicating test logic in shell scripts.

## Nightly broad validation

**Nightly broad validation** runs once per day and can also be triggered manually. It runs:

- default tests with `npm test`;
- extended river tests with `npm run test:extended`;
- repeated targeted deterministic/lifecycle checks with `npm run test:repeatable`;
- an informational river benchmark with `npm run benchmark:river`.

Logs and benchmark output are uploaded as artifacts. Long traversal tests, larger seed sweeps, and additional topology suites are not yet clean existing capabilities in this repository; add them later as real validation suites instead of weak placeholder tests.

## Optional coverage

Run **Coverage** manually to produce a Vitest coverage report:

```sh
npm run coverage
```

Coverage is informational only and is not a merge requirement. The workflow uploads the generated `coverage/` directory as an artifact. The repository uses the explicit `@vitest/coverage-v8` dev dependency for standard Vitest coverage support.

## Dependency and security automation

Dependabot is configured for weekly npm and GitHub Actions updates.

Secret scanning and push protection are repository settings, not guarantees provided by workflow YAML. Enable them in the GitHub repository security settings where available.
