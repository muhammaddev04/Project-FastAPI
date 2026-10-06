import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Match the named font sizes in tailwind.config.ts so text-body cannot erase a text colour.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            '2xs',
            'micro',
            'caption',
            'label',
            'body',
            'body-lg',
            'title-sm',
            'title',
            'title-lg',
            'display-sm',
            'display',
            'display-lg',
            'hero',
            'section',
            'statement',
            'section-sm',
            'lead',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
