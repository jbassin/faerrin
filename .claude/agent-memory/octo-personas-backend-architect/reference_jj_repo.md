---
name: reference-jj-repo
description: The faerrin repo is a jj (Jujutsu) repo backed by git — use jj for file moves, not git
metadata:
  type: reference
---

`/ruby/data/experiments/faerrin` has a `.jj/` dir at root (jj backed by git — `.jj/repo/store/git_target` present).
The git status/log still works (jj colocated), but file moves/renames for the monorepo migration
must be done with `jj` commands, not `git mv`, so jj tracks them correctly.
