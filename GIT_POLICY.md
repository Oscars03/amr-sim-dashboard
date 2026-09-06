# GIT_POLICY.md

Git rules for `amr-sim-dashboard`. Every rule here exists because it already
cost someone time — the reason is written next to it, so you can tell when a
rule applies and when it genuinely doesn't.

Applies to humans and to agents equally.

---

## 1. Never commit on `main`

Branch first, always. `main` is only ever advanced by merging a PR.

Undoing a commit made directly on `main` means force-pushing a shared branch,
and that breaks every other checkout and worktree pointed at this repo.

**Branch from a freshly fetched `origin/main`, not from local `main`:**

```bash
git fetch origin
git checkout -b fix/thing origin/main
```

> This is the one that actually bit us. In August 2026 local `main` drifted to
> ahead 9 / behind 5 — six camera commits and two fixes that existed on this
> laptop and nowhere else. Recovering it meant cherry-picking onto a fresh
> branch (#43) and resetting `main` to the remote. Local `main` looks like a
> safe base; it is not one unless you just fetched.

Check before you trust it:

```bash
git rev-list --left-right --count main...origin/main   # want "0	0"
```

## 2. Branch names

`<type>/<short-kebab-description>`, where type matches the commit type below.
In use: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `release/`.
Agent-generated branches under `claude/` are fine and follow the same rules.

## 3. Commit messages: conventional commits

```
<type>(<scope>): <subject in the imperative>
```

Types: `feat` `fix` `chore` `docs` `refactor` `perf` `test`.
Scopes actually in use: `sim` `ui` `dashboard` `camera` `monitor` `release`
`worlds`. The scope is optional — `docs: add RELEASE.md` is fine.

The body should say **why**, not restate the diff. A commit that only says what
changed is telling you something `git show` already would.

## 4. Pull requests

- **The body answers "why".** It is the permanent record of the reasoning, and
  it is what a reviewer uses to decide whether to merge. What changed is
  already in the diff.
- **State what you could not verify.** A PR that says "the Create World canvas
  was not confirmed visually" is more useful than one that quietly implies
  everything was checked.
- **CI must be green before merge.** The `lint-and-test` job runs on every PR.
- **Merge with a merge commit** (`gh pr merge <n> --merge`), not squash. The
  whole history is `Merge pull request #NN from ...`; squashing a multi-commit
  PR also collapses distinctions worth keeping, such as a behaviour fix and the
  doc change that explains it.
- **Delete the branch after merging** (`--delete-branch`). Stale merged
  branches make it hard to see what is actually in flight.

## 5. This checkout is shared

Other agent sessions and an Antigravity worktree operate on this same working
directory. The branch at `HEAD` can change without you doing anything, and
unfamiliar branches will appear. That is normal.

The real hazard is two sessions committing to the same branch from different
points. Before committing:

```bash
git rev-list --count @..@{u}    # 0 = safe; anything else, pull first
```

To open a PR for a branch you are not standing on, use `--head` rather than
checking it out — that avoids clobbering work another session has in the tree.

## 6. The ROS workspace is vendored, not a submodule

`simamr_ws/src/amr_2dsim/` is the `amr_2dsim` ROS 2 package, **tracked directly
in this repo**. There is no submodule and no separate clone to keep in sync —
edit it here and commit it here, like any other source.

Two consequences that are easy to miss:

- **CI does not build it.** `lint-and-test` is Node only. A Python change that
  does not import is caught by nobody but you. Run
  `python3 -m py_compile` on what you touched, at minimum.
- **`install/` is a build artifact, not the source.** It is gitignored and is
  *not* a symlink install, so editing the source changes nothing until you
  rebuild:

  ```bash
  cd simamr_ws && source /opt/ros/<distro>/setup.bash
  colcon build --merge-install --packages-select amr_2dsim
  ```

  If a fix "doesn't work", check this before checking the fix.

## 7. Build output stays out of the repo and out of tooling

`dist/`, `dist-electron/`, `out/`, `release/`, `build/`, `coverage/`,
`graphify-out/` and `simamr_ws/{build,install,log}/` are all gitignored. Never
commit them, and never point a linter or a search at them.

> `eslint.config.js` ignored only `dist` for a long time, so `npm run lint`
> reported 1296 findings of which 1290 came from bundled artifacts. The signal
> was completely buried; the real backlog was 33.

## 8. Releases

`RELEASE.md` owns the release procedure. Version lives in `package.json` and
`build_deb.sh` reads it from there — do not hand-edit the version in two
places.

## 9. Irreversible operations need a structural guard, not an instruction

Deleting a branch, force-pushing, resetting a shared ref: for these, an
instruction in a prompt is not a control. It is a request that will usually be
honoured and occasionally will not, and the one time it is not, the work is
gone.

> A branch-triage job was handed to an agent with the rule stated as plainly as
> it can be — *"read-only. No checkout, no rebase, no stash, no writes of any
> kind"*, with deletion gated behind a written verdict and its evidence. Within
> four minutes it had deleted four branches, local and remote, before running a
> single command that could have told it whether they were safe to delete. Its
> conclusions later turned out to be correct, every one of them. That is not
> the same as the process being safe: nothing recovered those branches except
> the SHAs happening to be sitting in another session's scrollback.

So, for anything that destroys a ref:

- **Establish recoverability first.** Record the SHAs, or tag them, before
  anything is deleted. `git branch rescue/<name> <sha>` costs nothing and is
  the difference between an inconvenience and a loss.
- **Prove the verdict before acting on it, not after.** Investigation is
  read-only and can be parallelised freely; deletion is a separate step that
  takes the investigation's output as input. If the two are in one step, the
  order collapses under pressure.
- **Prefer a guard the agent cannot talk its way past** — a separate worktree,
  a token without delete rights, a human confirmation — over a sentence in a
  prompt telling it not to.
- **A deletion with no recorded reason is a defect**, even when the deletion
  was correct. The reason is what lets the next person tell a considered
  cleanup from a mistake.

None of this applies to ordinary code changes, which are reviewable in a PR and
revertible with a commit. It applies to the operations where review happens
after the only copy is gone.

---

## Known gap

`.github/workflows/ci.yml` still runs `npm run lint` with
`continue-on-error: true`, carrying a comment about "pre-existing lint debt,
mostly in DashboardView.jsx". That debt was cleared in #26 and the tree lints
clean. The flag can be dropped so lint failures actually block a PR — worth
doing on its own, since it changes what CI rejects.
