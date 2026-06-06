// The wiki's location *inside the Git repo* (jbassin/faerrin), as opposed to its
// on-disk read path. heartwood reads the wiki at ctx.contentDir — '../content/wiki'
// relative to pkg/heartwood — but commits and PRs must address files by their path
// within the repo, which in this monorepo is pkg/content/wiki, NOT the pre-monorepo
// 'content/' root. Keeping that one fact here stops it from being hardcoded (wrongly)
// at every commit-path construction site.
export const WIKI_REPO_DIR = 'pkg/content/wiki';

/** A contentDir-relative page path ("Org/Foo.md") → its repo-relative path. */
export function toRepoPath(pagePath: string): string {
  return `${WIKI_REPO_DIR}/${pagePath}`;
}

/** Inverse of toRepoPath: a repo-relative path → contentDir-relative page path. */
export function fromRepoPath(repoPath: string): string {
  const prefix = `${WIKI_REPO_DIR}/`;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
}
