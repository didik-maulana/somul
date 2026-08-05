import { describe, expect, it } from 'vitest';

import { parseReleaseNotes } from '@/features/update/lib/parseReleaseNotes';

describe('parseReleaseNotes', () => {
  it('reads a heading without its markers', () => {
    expect(parseReleaseNotes('## Mixer')).toEqual([{ kind: 'heading', text: 'Mixer' }]);
  });

  it('groups consecutive bullets into one list', () => {
    expect(parseReleaseNotes('- First\n- Second\n* Third')).toEqual([
      { kind: 'list', items: ['First', 'Second', 'Third'] },
    ]);
  });

  /** Changelogs are written to a column width, so one bullet routinely spans two lines. */
  it('joins a wrapped bullet back into one item', () => {
    const blocks = parseReleaseNotes('- A row no longer claims a slider\n  it cannot move');

    expect(blocks).toEqual([
      { kind: 'list', items: ['A row no longer claims a slider it cannot move'] },
    ]);
  });

  it('keeps prose as paragraphs', () => {
    expect(parseReleaseNotes('Somul is a mixer.\nIt does one thing.')).toEqual([
      { kind: 'paragraph', text: 'Somul is a mixer. It does one thing.' },
    ]);
  });

  it('separates blocks on a blank line', () => {
    expect(parseReleaseNotes('First para.\n\nSecond para.')).toEqual([
      { kind: 'paragraph', text: 'First para.' },
      { kind: 'paragraph', text: 'Second para.' },
    ]);
  });

  it('reads a full changelog in order', () => {
    const blocks = parseReleaseNotes(
      'Somul 1.1.0.\n\n## Mixer\n- Volume is remembered\n- Mute is remembered\n\n## Fixes\n- The tray opens once\n',
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'heading',
      'list',
      'heading',
      'list',
    ]);
  });

  /** Notes written by someone not thinking about this function must still come out readable. */
  it('leaves unrecognised text alone', () => {
    expect(parseReleaseNotes('1. Numbered item')).toEqual([
      { kind: 'paragraph', text: '1. Numbered item' },
    ]);
  });

  it('returns nothing for empty notes', () => {
    expect(parseReleaseNotes('')).toEqual([]);
    expect(parseReleaseNotes('\n\n  \n')).toEqual([]);
  });
});
