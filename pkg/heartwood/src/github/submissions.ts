import { rename } from 'node:fs/promises';
import { z } from 'zod';

export const DiscussionMappingSchema = z.object({
  discussionId:  z.string(),
  proposalIndex: z.number().int().nonnegative(),
});

// `prNumber` is the GitHub PR number. Legacy files written before the GitLab→GitHub
// migration used `mrIid`; a preprocess step maps that key onto `prNumber` on read so
// existing committed submissions still parse. New writes always use `prNumber`.
export const SubmissionsFileSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && !('prNumber' in raw) && 'mrIid' in raw) {
    const { mrIid, ...rest } = raw as Record<string, unknown>;
    return { ...rest, prNumber: mrIid };
  }
  return raw;
}, z.object({
  filename:    z.string(),
  prNumber:    z.number().int().positive(),
  branch:      z.string(),
  discussions: z.array(DiscussionMappingSchema),
}));

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
