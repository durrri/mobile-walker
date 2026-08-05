# GitHub validation

GitHub Actions carries repeatable validation so Codex can focus on implementation and lightweight targeted inspection while GitHub compute handles clean installs, broad validation, benchmarks, coverage, and security analysis.

## Merge-blocking PR CI

`CI` runs automatically on every pull request and is intended to be the normal merge-blocking validation check. It stays fast and does not include extended tests, repeated suites, coverage, or benchmarks.

It runs:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `git diff --check`
6. informational build-size reporting

The workflow uses Node 22, npm caching, `contents: read` permissions, and a bounded timeout. The build-size report is informational only; no hard size budget is enforced yet.

## Manual extended validation

Run **Extended validation** from the Actions tab when a PR needs the expensive river checks:

```sh
npm run test:extended
```

This workflow is `workflow_dispatch` only. It uses Node 22, `npm ci`, npm caching, `contents: read` permissions, a 30-minute timeout, `set -euo pipefail` for the `tee` pipeline, a GitHub job summary, and an uploaded raw log retained for 7 days.

## Manual base-versus-head river benchmarks

Run **River benchmark** from the Actions tab for `npm run benchmark:river`.

- The ref selected in GitHub's **Run workflow** interface is always the benchmark head.
- `compare_ref` is optional and may be a base branch, tag, or SHA.
- Leave `compare_ref` empty to benchmark only the selected head ref.
- Provide `compare_ref` to benchmark that base and the selected head on the same GitHub runner.

When `compare_ref` is supplied, the workflow resolves it with Git and fails clearly if it cannot be fetched. It checks out the selected head into one source tree and creates a separate Git worktree for the base. Each source tree runs its own `npm ci`, so dependencies and generated files do not contaminate the other measurement. The job summary shows the resolved base and head SHAs, and raw benchmark logs are uploaded with 7-day retention.

GitHub runner timings are useful mainly for same-run base-versus-head comparisons. They should not be treated as exact long-term absolute performance measurements, and no fragile hard merge threshold is enforced yet.

## Manual repeated invariant validation

Run **Repeated invariants** from the Actions tab to repeatedly execute deterministic and lifecycle-focused existing Vitest files:

```sh
npm run test:repeatable
```

The workflow is `workflow_dispatch` only. It accepts a repetition count input with default 10, minimum 1, and maximum 50. It uses Node 22, `npm ci`, npm caching, `contents: read` permissions, and a clear timeout. It invokes the npm script for each repetition, fails immediately on the first failed repetition, and reports the failed repetition number in the log instead of duplicating invariant logic in shell.

## Periodic broad validation

**Periodic broad validation** runs on Monday, Wednesday, and Friday at `17 8 * * 1,3,5` UTC and can also be triggered manually with `workflow_dispatch`. Scheduled workflows have no fixed end date, so scheduled runs include a cheap Git-based activity guard before Node setup or `npm ci`.

For scheduled runs only, the workflow checks the latest commit time on the default branch. If the default branch has had no commits in the previous 7 days, it skips the expensive validation suite, writes a clear GitHub job summary explaining the inactivity skip, and finishes successfully. New commits automatically make future scheduled runs useful again.

Manual `workflow_dispatch` runs always execute the complete workflow regardless of repository inactivity.

When active, the periodic workflow fails immediately on validation failure and runs:

- `npm test`
- `npm run test:extended`
- 10 repetitions of `npm run test:repeatable`
- `npm run benchmark:river` as informational output

The raw periodic logs and benchmark output are uploaded with 7-day retention. Long traversal tests, larger seed sweeps, and additional topology suites are not yet clean existing capabilities in this repository; add them later as real validation suites instead of weak placeholder tests.

## Manual coverage

Run **Coverage** manually to produce a Vitest coverage report:

```sh
npm run coverage
```

Coverage is `workflow_dispatch` only and informational. The workflow uses Node 22, `npm ci`, npm caching, `contents: read` permissions, and a clear timeout. It does not enforce a merge-blocking coverage percentage. The generated `coverage/` directory is uploaded with 7-day retention. The repository uses the explicit `@vitest/coverage-v8` dev dependency for standard Vitest coverage support.

## Dependency and security automation

Dependabot is configured for weekly npm updates and weekly GitHub Actions updates.

`CodeQL` runs on pull requests, on a weekly schedule, and by manual dispatch for JavaScript/TypeScript analysis. The workflow uses least-privilege permissions for CodeQL: `contents: read` and `security-events: write`.

Secret scanning and push protection are repository settings, not guarantees provided by workflow YAML. Enable them in the GitHub repository security settings where available.
