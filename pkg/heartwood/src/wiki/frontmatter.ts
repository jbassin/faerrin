import { parse as parseYaml } from 'yaml';

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FENCE = /^---\r?\n/;

export function parseFrontmatter(text: string, sourcePath?: string): Frontmatter {
  if (!FENCE.test(text)) return { data: {}, body: text };
  const afterOpen = text.replace(FENCE, '');
  const closeIdx = afterOpen.search(/^---\r?\n?/m);
  if (closeIdx < 0) return { data: {}, body: text };
  const yamlText = afterOpen.slice(0, closeIdx);
  const body = afterOpen.slice(closeIdx).replace(/^---\r?\n?/, '');
  let data: unknown;
  try {
    data = parseYaml(yamlText) ?? {};
  } catch (err) {
    const where = sourcePath ? ` in ${sourcePath}` : '';
    throw new Error(`Invalid YAML frontmatter${where}: ${(err as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { data: {}, body };
  }
  return { data: data as Record<string, unknown>, body };
}
