import { test, expect } from 'bun:test';
import {
  normalizeSentence,
  parsePageSentences,
  anchorForBody,
  reanchor,
} from './anchor';

const PAGE = `Sableclutch is a poorer neighborhood at the southernmost point of [[Hallia]]. Hugging the south bank of the Fousan River, it is dominated by the dockworkers that ply their trade on the river.

The district is somewhat overlooked by the rest of the capital.

### Character of the District

The streets are relatively winding. Goblinoid workers commute through them in workman's attire.`;

test('normalizeSentence strips wikilinks, emphasis, html, and case', () => {
  expect(normalizeSentence('The **[[Roundhat Gang]]** rules <br /> here.')).toBe(
    'the roundhat gang rules here.',
  );
  expect(normalizeSentence('See [[path/to/Hallia|Hallia]] now.')).toBe('see hallia now.');
  expect(normalizeSentence('Visit [[Geography/Calaria#History]].')).toBe('visit calaria.');
});

test('parsePageSentences tracks heading sections and skips non-prose', () => {
  const s = parsePageSentences(PAGE);
  const top = s.filter((x) => x.headingPath.length === 0);
  const section = s.filter((x) => x.headingPath.join('') === 'Character of the District');
  expect(top.length).toBe(3); // two in first para, one in second
  expect(section.length).toBe(2);
  // ` :: ` stat lines and html-only lines are not prose sentences.
  const statty = parsePageSentences('**Edicts** :: be kind <br />\n\nReal prose here.');
  expect(statty.map((x) => x.text)).toEqual(['Real prose here.']);
});

test('exact re-anchor on an unchanged page returns the same sentence', () => {
  const a = anchorForBody(PAGE, 2); // "The district is somewhat overlooked..."
  const r = reanchor(PAGE, a);
  expect(r.stale).toBe(false);
  expect(parsePageSentences(PAGE)[r.index!]!.text).toContain('overlooked by the rest');
});

test('inserting a sentence earlier still re-anchors by hash to the shifted index', () => {
  const a = anchorForBody(PAGE, 2);
  const edited = PAGE.replace(
    'Sableclutch is a poorer neighborhood',
    'A new opening sentence sits here. Sableclutch is a poorer neighborhood',
  );
  const r = reanchor(edited, a);
  expect(r.stale).toBe(false);
  expect(parsePageSentences(edited)[r.index!]!.text).toContain('overlooked by the rest');
});

test('rewording a neighbor does not disturb the target anchor', () => {
  const a = anchorForBody(PAGE, 2);
  const edited = PAGE.replace(
    'Hugging the south bank of the Fousan River, it is dominated by the dockworkers that ply their trade on the river.',
    'It is dominated by warehouse crews.',
  );
  const r = reanchor(edited, a);
  expect(r.stale).toBe(false);
  expect(parsePageSentences(edited)[r.index!]!.text).toContain('overlooked by the rest');
});

test('lightly rewording the target sentence fuzzy-re-anchors and yields an updated anchor', () => {
  const a = anchorForBody(PAGE, 2);
  const edited = PAGE.replace(
    'The district is somewhat overlooked by the rest of the capital.',
    'The district is somewhat overlooked by the rest of the capital these days.',
  );
  const r = reanchor(edited, a);
  expect(r.stale).toBe(false);
  expect(r.updated).toBeDefined();
  expect(r.updated!.normHash).not.toBe(a.normHash);
  expect(parsePageSentences(edited)[r.index!]!.text).toContain('these days');
});

test('moving the sentence to a different heading section goes stale', () => {
  const a = anchorForBody(PAGE, 2); // top-level section
  const moved = PAGE
    .replace('\nThe district is somewhat overlooked by the rest of the capital.\n', '\n')
    .replace(
      '### Character of the District\n',
      '### Character of the District\nThe district is somewhat overlooked by the rest of the capital.\n',
    );
  const r = reanchor(moved, a);
  expect(r.stale).toBe(true);
  expect(r.index).toBeNull();
});

test('deleting the sentence goes stale', () => {
  const a = anchorForBody(PAGE, 2);
  const deleted = PAGE.replace(
    '\nThe district is somewhat overlooked by the rest of the capital.\n',
    '\n',
  );
  const r = reanchor(deleted, a);
  expect(r.stale).toBe(true);
  expect(r.index).toBeNull();
});
