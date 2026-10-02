import { Building2, ShieldCheck, Store, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { initialsOf } from '@/shared/lib/initials';

/**
 * Identity marks, one per entity kind (DESIGN.md): a **person** is a round initials badge on the teal→blue gradient;
 * a **company** is the rounded teal tile of the TezFarmo mark with a building; a **store** is the same tile on the
 * sky→blue gradient with a storefront. The shapes and hues keep User / Company / Store apart at a glance.
 *
 * CR-003: with `src` (a signed avatar / logo / store image URL) the picture fills the same shape. Signed URLs expire
 * after 5 minutes, so a picture that fails to load falls back to the mark instead of a broken image.
 */
export type AvatarKind = 'person' | 'company' | 'store';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<Size, { box: string; text: string; icon: string; badge: string }> = {
  xs: { box: 'size-7', text: 'text-micro', icon: 'size-3.5', badge: 'hidden' },
  sm: { box: 'size-8', text: 'text-micro', icon: 'size-4', badge: 'hidden' },
  md: { box: 'size-10', text: 'text-xs', icon: 'size-5', badge: 'size-4 [&_svg]:size-2.5' },
  lg: { box: 'size-14', text: 'text-base', icon: 'size-7', badge: 'size-5 [&_svg]:size-3' },
  xl: { box: 'size-16 sm:size-20', text: 'text-xl sm:text-2xl', icon: 'size-8 sm:size-9', badge: 'size-6 [&_svg]:size-3.5' },
};

/*
 * The hue still tells a person from a company from a store, which is information. The gradient and the
 * coloured glow behind each one were not: three fills meant three gradients and three glow shadows for what
 * is, at 32px, a solid coloured square with a letter on it.
 */
const KIND: Record<AvatarKind, { shape: string; fill: string; icon?: LucideIcon }> = {
  person: { shape: 'rounded-full', fill: 'bg-brand-blue' },
  company: { shape: 'rounded-2xl', fill: 'bg-brand', icon: Building2 },
  store: { shape: 'rounded-2xl', fill: 'bg-brand-sky', icon: Store },
};

export function Avatar({
  name,
  kind = 'person',
  size = 'sm',
  verified = false,
  src,
  alt,
  className,
}: {
  /** Person initials come from the name; organizations show their kind's icon. */
  name?: string;
  kind?: AvatarKind;
  size?: Size;
  verified?: boolean;
  /** CR-003 signed image URL; null/undefined shows the mark. */
  src?: string | null;
  /** Accessible text for the picture. Without it the mark is decorative (the name is shown next to it). */
  alt?: string;
  className?: string;
}) {
  const s = SIZES[size];
  const k = KIND[kind];
  const Icon = k.icon;
  const [failed, setFailed] = useState<string | null>(null);
  const picture = src && failed !== src ? src : null;
  return (
    <span
      aria-hidden={picture && alt ? undefined : true}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center font-display font-semibold text-white',
        s.box,
        k.shape,
        k.fill,
        className,
      )}
    >
      {picture ? (
        <img
          src={picture}
          alt={alt ?? ''}
          // rounded-[inherit]: the picture takes the mark's shape, including a caller's override (e.g. rounded-xl).
          className="size-full rounded-[inherit] bg-surface object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(picture)}
        />
      ) : Icon ? (
        <Icon className={s.icon} />
      ) : (
        <span className={s.text}>{initialsOf(name ?? '')}</span>
      )}
      {verified ? (
        <span className={cn('absolute -bottom-1 -right-1 flex items-center justify-center rounded-full border-2 border-surface bg-success text-white', s.badge)}>
          <ShieldCheck />
        </span>
      ) : null}
    </span>
  );
}
