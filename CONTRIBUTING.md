# Contributing

OpenAX is early-stage. Issues and small, focused PRs are welcome.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run demo      # end-to-end walkthrough with a scripted model
```

Requires Node.js 22+ and git.

## Commit messages: Conventional Commits

Releases are automated with [release-please](https://github.com/googleapis/release-please). It reads commit messages on `main`, so they must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add --diff flag to openax context
fix(git): include untracked files in staged mode
docs: explain decision file format
feat!: rename config key max_diff_chars
```

| Type | Effect on the next release (while < 1.0) |
|---|---|
| `feat` | minor bump (0.1.0 → 0.2.0), listed in the changelog |
| `fix`, `perf` | patch bump (0.1.0 → 0.1.1), listed in the changelog |
| `feat!` / `BREAKING CHANGE:` footer | minor bump before 1.0, major after |
| `docs` | listed in the changelog, no release on its own |
| `refactor`, `test`, `build`, `ci`, `chore` | no release, hidden from the changelog |

PRs are **squash-merged**, so the **PR title** becomes the commit on `main`. The `PR title` workflow checks that it is a valid Conventional Commit. The commits inside a PR can be anything.

## Releases

1. Merging to `main` makes release-please open or update a "chore(main): release x.y.z" PR with the version bump and `CHANGELOG.md`.
2. Merging that PR tags the release, creates a GitHub release and publishes the package to npm.

Don't edit versions or `CHANGELOG.md` by hand.
