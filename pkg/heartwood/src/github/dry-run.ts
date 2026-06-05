import { mkdir, rename } from 'node:fs/promises';
import type { CommitAction } from './client';
import type { DiscussionMapping } from './submissions';

export interface DryRunOutput {
  dryRunDir:        string;
  changesPath:      string;
  descriptionPath:  string;
  notesPath:        string;
  discussionsPath:  string;
}

export async function writeDryRun(
  basename:    string,
  actions:     CommitAction[],
  description: string,
  notes:       string[],
  discussions: DiscussionMapping[],
  dryRunsDir:  string,
): Promise<DryRunOutput> {
  const dryRunDir       = `${dryRunsDir}/${basename}`;
  const changesPath     = `${dryRunDir}/changes.json`;
  const descriptionPath = `${dryRunDir}/pr-description.md`;
  const notesPath       = `${dryRunDir}/notes.json`;
  const discussionsPath = `${dryRunDir}/discussions.json`;

  await mkdir(dryRunDir, { recursive: true });

  const changesTmp = `${changesPath}.tmp`;
  await Bun.write(changesTmp, JSON.stringify(actions, null, 2) + '\n');
  await rename(changesTmp, changesPath);

  const descriptionTmp = `${descriptionPath}.tmp`;
  await Bun.write(descriptionTmp, description);
  await rename(descriptionTmp, descriptionPath);

  const notesTmp = `${notesPath}.tmp`;
  await Bun.write(notesTmp, JSON.stringify(notes, null, 2) + '\n');
  await rename(notesTmp, notesPath);

  const discussionsTmp = `${discussionsPath}.tmp`;
  await Bun.write(discussionsTmp, JSON.stringify(discussions, null, 2) + '\n');
  await rename(discussionsTmp, discussionsPath);

  return { dryRunDir, changesPath, descriptionPath, notesPath, discussionsPath };
}
