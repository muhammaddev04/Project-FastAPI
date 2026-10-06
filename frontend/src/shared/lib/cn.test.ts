import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('named typography and colour merging', () => {
  it('preserves button text colour with workspace font sizes', () => {
    expect(cn('bg-primary text-primary-foreground', 'text-body')).toBe('bg-primary text-primary-foreground text-body');
  });

  it('replaces font size independently of colour', () => {
    expect(cn('text-primary text-body', 'text-label text-danger')).toBe('text-label text-danger');
  });
});
