import { describe, expect, it } from 'bun:test';
import { hasStrippedConstructs, strippedConstructsIn, toSanitizerSafe } from './render-safe';

describe('toSanitizerSafe — wikilinks → display text (AC-23)', () => {
  it('renders a bare wikilink as its last path segment', () => {
    expect(toSanitizerSafe('Trade flows through [[Sableclutch]].')).toBe(
      'Trade flows through Sableclutch.',
    );
  });

  it('prefers the alias when present', () => {
    expect(toSanitizerSafe('the [[Sableclutch|river district]] hums')).toBe(
      'the river district hums',
    );
  });

  it('strips path and #anchor from the display text', () => {
    expect(toSanitizerSafe('see [[Places/Sableclutch#Trade]]')).toBe('see Sableclutch');
  });
});

describe('toSanitizerSafe — Obsidian inline fields → bold labels (deity stat blocks)', () => {
  it('converts `Key:: value` lines', () => {
    expect(toSanitizerSafe('Alignment:: Lawful Neutral')).toBe('**Alignment:** Lawful Neutral');
  });

  it('leaves `::` inside prose alone (only line-leading fields convert)', () => {
    const prose = 'He paused — then spoke.';
    expect(toSanitizerSafe(prose)).toBe(prose);
  });
});

describe('toSanitizerSafe — strips constructs GitHub would drop', () => {
  it('removes class/style attributes and unwraps div/span', () => {
    const aetherish = '<div class="callout" style="color:red"><span class="x">Beware the docks.</span></div>';
    const safe = toSanitizerSafe(aetherish);
    expect(safe).toBe('Beware the docks.');
    expect(hasStrippedConstructs(safe)).toBe(false);
  });

  it('removes <style>/<iframe>/<script> blocks wholesale (GitHub strips them)', () => {
    const nasty = 'Keep this.<style>.x{color:red}</style><iframe src="x"></iframe><script>evil()</script> And this.';
    const safe = toSanitizerSafe(nasty);
    expect(safe).toBe('Keep this. And this.');
    expect(hasStrippedConstructs(safe)).toBe(false);
  });
});

describe('hasStrippedConstructs — the AC-23 round-trip gate', () => {
  it('flags raw aether HTML and unrendered wikilinks', () => {
    expect(hasStrippedConstructs('<div class="callout">x</div>')).toBe(true);
    expect(hasStrippedConstructs('[[Sableclutch]]')).toBe(true);
    expect(strippedConstructsIn('<div style="x">[[Y]]')).toContain('div element');
  });

  it('passes plain GFM prose', () => {
    expect(hasStrippedConstructs('Trade flows through **Sableclutch** — overlooked by the capital.')).toBe(
      false,
    );
  });

  it('round-trip: any wiki markdown becomes sanitizer-safe', () => {
    const samples = [
      'The [[Drowned Court|court]] rules from <div class="callout" style="x">below</div>.',
      'Domain:: Water\nAlignment:: NE',
      'Plain prose with an em-dash — nothing fancy.',
      '> [!note] a callout\n> body with a [[Wikilink]]',
    ];
    for (const s of samples) {
      expect(hasStrippedConstructs(toSanitizerSafe(s))).toBe(false);
    }
  });
});
