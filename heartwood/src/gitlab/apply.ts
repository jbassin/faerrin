import type { Proposal } from '../reconcile/propose';
import type { CommitAction } from './client';

export interface ApplyContext {
  contentDir: string;
}

export async function buildCommitActions(
  proposals: Proposal[],
  ctx: ApplyContext,
): Promise<CommitAction[]> {
  // filePath (repo-relative) → current content
  const fileContents = new Map<string, string>();
  // Tracks final action type per file (create vs update)
  const actionTypes = new Map<string, 'create' | 'update'>();

  async function getContent(filePath: string, diskPath: string): Promise<string> {
    if (fileContents.has(filePath)) return fileContents.get(filePath)!;
    const file = Bun.file(diskPath);
    const text = (await file.exists()) ? await file.text() : '';
    fileContents.set(filePath, text);
    actionTypes.set(filePath, 'update');
    return text;
  }

  for (const proposal of proposals) {
    if (proposal.kind === 'comment') continue;

    const filePath = `content/${proposal.path}`;
    const diskPath = `${ctx.contentDir}/${proposal.path}`;

    if (proposal.kind === 'create') {
      if (fileContents.has(filePath)) {
        throw new Error(`create: duplicate path — ${filePath} already exists`);
      }
      fileContents.set(filePath, proposal.content);
      actionTypes.set(filePath, 'create');
      continue;
    }

    if (proposal.kind === 'edit') {
      const current = await getContent(filePath, diskPath);
      const occurrences = countOccurrences(current, proposal.oldText);
      if (occurrences === 0) {
        throw new Error(`edit: oldText not found in ${filePath}`);
      }
      if (occurrences > 1) {
        throw new Error(`edit: oldText not unique in ${filePath} (found ${occurrences} times)`);
      }
      fileContents.set(filePath, current.replace(proposal.oldText, proposal.newText));
      if (!actionTypes.has(filePath)) actionTypes.set(filePath, 'update');
      continue;
    }

    if (proposal.kind === 'append') {
      const current = await getContent(filePath, diskPath);
      let next: string;
      if (proposal.afterHeading === null) {
        next = current.trimEnd() + '\n\n' + proposal.content;
      } else {
        const headingRe = new RegExp(`^#{1,6}\\s+${escapeRegExp(proposal.afterHeading)}$`, 'm');
        const match = headingRe.exec(current);
        if (!match) {
          throw new Error(`append: heading "${proposal.afterHeading}" not found in ${filePath}`);
        }
        const insertAt = match.index + match[0].length;
        next = current.slice(0, insertAt) + '\n\n' + proposal.content + current.slice(insertAt);
      }
      fileContents.set(filePath, next);
      if (!actionTypes.has(filePath)) actionTypes.set(filePath, 'update');
      continue;
    }
  }

  const actions: CommitAction[] = [];
  for (const [filePath, content] of fileContents) {
    actions.push({ action: actionTypes.get(filePath)!, filePath, content });
  }
  return actions;
}

function countOccurrences(text: string, search: string): number {
  if (search === '') return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
