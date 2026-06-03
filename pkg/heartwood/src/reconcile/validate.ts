import type { Proposal, EditProposal, CreateProposal, AppendProposal } from './propose';
import type { Segment } from '../transcript/segment';
import { parseFrontmatter } from '../wiki/frontmatter';
import type { WikiIndex } from '../wiki/index-schema';
import { EXTRACT_LABELS } from '../transcript/extract';

export interface ValidateCtx {
  contentDir: string;
  segments: Segment[];
  wikiIndex: WikiIndex;
}

export type ValidateResult =
  | { ok: true;  proposal: Proposal }
  | { ok: false; reason: string };

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos++;
  }
  return count;
}

function citationsInExtractSegments(
  citations: [number, number][],
  segments: Segment[],
): string | null {
  for (const [start, end] of citations) {
    const ok = segments.some(
      (s) =>
        (EXTRACT_LABELS as readonly string[]).includes(s.label) &&
        s.startLine <= start &&
        s.endLine >= end,
    );
    if (!ok) return `citation-not-in-extract-segment:${start}-${end}`;
  }
  return null;
}

function extractHeadings(body: string): string[] {
  return body
    .split('\n')
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^#{1,6}\s+/, '').trim());
}

export async function validateProposal(p: Proposal, ctx: ValidateCtx): Promise<ValidateResult> {
  const fail = (reason: string): ValidateResult => {
    console.warn(`validate: dropping proposal — ${reason}`);
    return { ok: false, reason };
  };

  // 1. Citations in extract segments (all kinds).
  const citError = citationsInExtractSegments(
    p.citations as [number, number][],
    ctx.segments,
  );
  if (citError) return fail(citError);

  // 2. No Rules target.
  if (p.kind === 'edit' || p.kind === 'append') {
    if (p.path.startsWith('Rules/')) return fail('target-in-rules');
  }
  if (p.kind === 'create') {
    if (p.path.startsWith('Rules/')) return fail('create-in-rules');
  }

  // 3–7: Kind-specific validation.
  if (p.kind === 'edit') {
    const editFile = Bun.file(`${ctx.contentDir}/${p.path}`);
    let pageText: string;
    try {
      if (!(await editFile.exists())) return fail('target-missing');
      pageText = await editFile.text();
    } catch {
      return fail('target-missing');
    }
    const count = countOccurrences(pageText, p.oldText);
    if (count !== 1) return fail(`oldText-not-unique:count=${count}`);

    const postEdit = pageText.replace(p.oldText, p.newText);
    try {
      parseFrontmatter(postEdit);
    } catch {
      return fail('frontmatter-invalid-after-edit');
    }
  }

  if (p.kind === 'append') {
    const appendFile = Bun.file(`${ctx.contentDir}/${p.path}`);
    if (!(await appendFile.exists())) return fail('target-missing');
    if (p.afterHeading !== null) {
      const pageText = await appendFile.text();
      const { body } = parseFrontmatter(pageText);
      const headings = extractHeadings(body);
      if (!headings.includes(p.afterHeading)) {
        return fail(`heading-not-found:${p.afterHeading}`);
      }
    }
  }

  if (p.kind === 'create') {
    if (p.path in ctx.wikiIndex.pages) return fail('path-already-exists');
    const parent = p.path.split('/').slice(0, -1).join('/');
    const hasParent = Object.keys(ctx.wikiIndex.pages).some((pp) => {
      const dir = pp.split('/').slice(0, -1).join('/');
      return dir === parent;
    });
    if (!hasParent) return fail('parent-directory-missing');

    try {
      parseFrontmatter(p.content);
    } catch {
      return fail('frontmatter-invalid');
    }

    // Sibling frontmatter consistency (≥3 siblings required).
    const siblings = Object.entries(ctx.wikiIndex.pages).filter(([pp]) => {
      const dir = pp.split('/').slice(0, -1).join('/');
      return dir === parent && pp !== p.path;
    });
    if (siblings.length >= 3) {
      const siblingKeys = siblings.map(([, rec]) => Object.keys(rec));
      // Use wiki page record keys (title, aliases, tags, etc.) as stand-ins for frontmatter keys.
      // The real check is on the parsed frontmatter of the actual sibling files.
      // Per the plan: "Compute the intersection of frontmatter keys across siblings."
      // We load sibling files from disk to check their frontmatter keys.
      const siblingFrontmatterKeys: string[][] = [];
      for (const [sibPath] of siblings) {
        const sibFile = Bun.file(`${ctx.contentDir}/${sibPath}`);
        if (await sibFile.exists()) {
          const text = await sibFile.text();
          try {
            const fm = parseFrontmatter(text);
            siblingFrontmatterKeys.push(Object.keys(fm.data));
          } catch {
            // ignore parse errors in siblings
          }
        }
      }

      if (siblingFrontmatterKeys.length >= 3) {
        const intersection = siblingFrontmatterKeys.reduce((acc, keys) => {
          return acc.filter((k) => keys.includes(k));
        });
        if (intersection.length > 0) {
          const newFm = parseFrontmatter(p.content);
          const newKeys = Object.keys(newFm.data);
          const missing = intersection.filter((k) => !newKeys.includes(k));
          if (missing.length > 0) {
            return fail(`missing-frontmatter-keys:${missing.join(',')}`);
          }
        }
      }
    }
  }

  return { ok: true, proposal: p };
}
