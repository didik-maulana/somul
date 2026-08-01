import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The type scale (`@utility text-label` and friends) is `text-*` shaped, so tailwind-merge cannot
 * tell it apart from `text-<color>` and keeps only whichever came last. That silently deleted the
 * size from every `cn('text-label', isMuted && 'text-muted-foreground')` in the app, dropping the
 * element to its inherited size. Registering the scale as font-size makes the groups distinct
 * again: a size still overrides a size, but a colour no longer overrides a size.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['display', 'title', 'body', 'label', 'caption', 'micro', 'numeric', 'readout'] },
      ],
    },
  },
});

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
