import { loadWikiIndex, writeIndex, diffIndex, mergeIndex } from '../wiki/load';
import { summarizeWikiPages } from '../wiki/summarize';
import type { Command } from 'commander';

const CONTENT_DIR = 'content';
const INDEX_PATH = 'state/wiki-index.json';

export interface IndexWikiCliOptions {}

export async function indexWiki(
  flags: { check?: boolean; llm?: boolean; force?: boolean },
  opts: IndexWikiCliOptions = {},
): Promise<void> {
  void opts;
  const check = flags.check ?? false;
  const noLlm = flags.llm === false;
  const force = flags.force ?? false;

  const fresh = await loadWikiIndex({ contentDir: CONTENT_DIR });

  if (check) {
    const diff = await diffIndex(fresh, INDEX_PATH);
    if (!diff.stale) {
      console.log(`index up to date: ${fresh.pageCount} pages`);
      return;
    }
    console.error(
      `wiki index is stale: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`,
    );
    for (const p of diff.added) console.error(`  + ${p}`);
    for (const p of diff.removed) console.error(`  - ${p}`);
    for (const p of diff.changed) console.error(`  ~ ${p}`);
    process.exit(1);
  }

  // Carry forward summaries for unchanged pages
  const onDiskFile = Bun.file(INDEX_PATH);
  let merged = fresh;
  if (!force && (await onDiskFile.exists())) {
    const ondisk = JSON.parse(await onDiskFile.text());
    merged = mergeIndex(fresh, ondisk);
  }

  // Summarize pages that still have null summary
  const { enriched, failures } = await summarizeWikiPages(merged.pages, {
    contentDir: CONTENT_DIR,
    force,
    noLlm,
  });

  // Apply enriched results back into merged index
  for (const [path, result] of Object.entries(enriched)) {
    if (merged.pages[path]) {
      merged.pages[path] = { ...merged.pages[path]!, ...result };
    }
  }

  await writeIndex(merged, INDEX_PATH);

  const linkCount = Object.values(merged.pages).reduce((n, p) => n + p.wikilinks.length, 0);
  const summarized = Object.values(merged.pages).filter((p) => p.summary !== null).length;
  console.log(
    `wrote ${INDEX_PATH}: ${merged.pageCount} pages, ${summarized} summarized, ` +
      `${linkCount} wikilinks, ${merged.unresolvedLinks.length} unresolved`,
  );

  if (failures.length) {
    console.error(`${failures.length} page(s) failed to summarize:`);
    for (const f of failures) console.error(`  ! ${f}`);
    process.exit(1);
  }
}

export function register(program: Command): void {
  program
    .command('index-wiki')
    .description('Index wiki pages and optionally summarize with LLM')
    .option('--check',  'exit non-zero if index is stale without writing')
    .option('--no-llm', 'skip LLM summarization')
    .option('--force',  'rescan all pages even if contentHash matches')
    .action((opts: { check?: boolean; llm?: boolean; force?: boolean }) => indexWiki(opts));
}
