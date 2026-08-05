import { useMemo, type FC } from 'react';

import { parseReleaseNotes } from '@/features/update/lib/parseReleaseNotes';

export interface ReleaseNotesProps {
  notes: string;
}

/**
 * The changelog, laid out by shape rather than dumped as text.
 *
 * Headings get the only weight change on the page and hang on their own line; bullets get a hard
 * left edge to scan down. Nothing here is decorated — a release note is read once, quickly, to
 * answer one question: is this worth restarting for.
 */
export const ReleaseNotes: FC<ReleaseNotesProps> = ({ notes }) => {
  const blocks = useMemo(() => parseReleaseNotes(notes), [notes]);

  return (
    <div data-testid="release-notes" className="flex flex-col gap-3">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index.toString()}`;

        if (block.kind === 'heading') {
          return (
            <h2
              key={key}
              className="text-label text-foreground mt-2 font-semibold first:mt-0"
            >
              {block.text}
            </h2>
          );
        }

        if (block.kind === 'list') {
          return (
            <ul key={key} className="flex flex-col gap-1.5">
              {block.items.map((item) => (
                <li
                  key={item}
                  className="text-caption text-muted-foreground border-border border-l pl-2.5 leading-relaxed"
                >
                  {item}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={key} className="text-caption text-muted-foreground leading-relaxed">
            {block.text}
          </p>
        );
      })}
    </div>
  );
};
