import { rename } from 'node:fs/promises';
import { z } from 'zod';

export const DiscussionMappingSchema = z.object({
  discussionId:  z.string(),
  proposalIndex: z.number().int().nonnegative(),
});

export const SubmissionsFileSchema = z.object({
  filename:    z.string(),
  mrIid:       z.number().int().positive(),
  branch:      z.string(),
  discussions: z.array(DiscussionMappingSchema),
});

export type DiscussionMapping = z.infer<typeof DiscussionMappingSchema>;
export type SubmissionsFile   = z.infer<typeof SubmissionsFileSchema>;

export async function readSubmissions(path: string): Promise<SubmissionsFile | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return SubmissionsFileSchema.parse(JSON.parse(await file.text()));
}

export async function writeSubmissions(path: string, data: SubmissionsFile): Promise<void> {
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, path);
}
