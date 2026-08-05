export type ReleaseNoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

const HEADING = /^#{1,6}\s+/;
const BULLET = /^[-*]\s+/;

/**
 * Turns a release-note body into blocks the window can lay out.
 *
 * Release notes arrive as whatever the manifest carried, which in practice is the Markdown someone
 * typed into a GitHub release. Rendering that verbatim gives a wall of text where the `-` and `##`
 * are visible and the structure is not, and a long changelog is exactly where structure is what
 * makes it readable.
 *
 * Only the three shapes that actually appear are recognised. This is not a Markdown parser and
 * must not grow into one: anything it does not understand stays as plain text, which is the right
 * outcome for a body written by someone who was not thinking about this function.
 */
export const parseReleaseNotes = (notes: string): ReleaseNoteBlock[] => {
  const blocks: ReleaseNoteBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  const closeList = () => {
    if (items.length > 0) {
      blocks.push({ kind: 'list', items });
      items = [];
    }
  };

  for (const rawLine of notes.split('\n')) {
    const line = rawLine.trim();

    if (line === '') {
      closeParagraph();
      closeList();
      continue;
    }

    if (HEADING.test(line)) {
      closeParagraph();
      closeList();
      blocks.push({ kind: 'heading', text: line.replace(HEADING, '') });
      continue;
    }

    if (BULLET.test(line)) {
      closeParagraph();
      items.push(line.replace(BULLET, ''));
      continue;
    }

    // A line under a bullet that is not itself a bullet is that bullet wrapping, not a new
    // paragraph — changelogs are written to a column width, and treating the wrap as its own
    // block breaks one sentence into two unrelated-looking pieces.
    if (items.length > 0) {
      items[items.length - 1] += ` ${line}`;
      continue;
    }

    paragraph.push(line);
  }

  closeParagraph();
  closeList();

  return blocks;
};
