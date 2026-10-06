import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { assetSrc, type AssetSlot } from './media-assets';

/**
 * Image-led composition for the public site (Phase E4).
 *
 * The repository ships no photography, and inventing it is not an option: a stock photo of strangers in a
 * warehouse is exactly the generic corporate filler this redesign is meant to avoid, and a fabricated product
 * screenshot would be a lie a visitor could catch after signing up.
 *
 * So `Figure` is built to be the final composition either way. Give it a `src` and it renders the photograph
 * with the art direction already decided: aspect ratio, full bleed or inset, a mask that wipes open as the band
 * arrives, and a very slow scale that settles once. Give it no `src` and it renders `children`, which for every
 * call site here is a designed graphic built from real interface parts. The page is finished now and gets
 * richer when the assets land, with no layout work at that point.
 *
 * The slots themselves live in `media-assets.ts`.
 */

const ASPECT: Record<AssetSlot['aspect'], string> = {
  '21/9': 'aspect-[16/10] sm:aspect-[21/9]',
  '16/9': 'aspect-[4/3] sm:aspect-[16/9]',
  '4/5': 'aspect-[4/3] sm:aspect-[4/5]',
};

/**
 * The reveal: a mask that opens from the bottom while the content settles from a 1.04 scale.
 *
 * One wipe, once, on the shared easing curve. It is the only place the site scales anything, because a large
 * visual arriving is the one moment where motion carries information: it tells the eye the band is the subject
 * now. `MotionConfig reducedMotion="user"` in the shell drops the transform and leaves the fade.
 */
export function Figure({
  slot,
  bleed = false,
  className,
  children,
}: {
  slot: AssetSlot;
  /** Full viewport width, escaping the 80rem frame. */
  bleed?: boolean;
  className?: string;
  /** The graphic composition used until the photograph exists. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const src = assetSrc(slot.file);
  return (
    <motion.figure
      className={cn('relative overflow-hidden bg-subtle', bleed ? 'w-full' : 'rounded-2xl border', ASPECT[slot.aspect], className)}
      initial={{ clipPath: 'inset(18% 0% 0% 0%)', opacity: 0 }}
      whileInView={{ clipPath: 'inset(0% 0% 0% 0%)', opacity: 1 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
    >
      {src ? (
        <motion.img
          src={src}
          style={{ backgroundImage: `var(--preview-${src.replace(/^\/media\/tezfarmo-|\.webp$/g, '')})`, backgroundSize: 'cover' }}
          srcSet={`${src.replace('.webp', '-640.webp')} 640w, ${src} 1280w`}
          sizes={bleed ? '100vw' : '(max-width: 640px) 100vw, 50vw'}
          alt={t(`site.media.${slot.file.replace(/^media\/|\.jpg$/g, '')}.alt`)}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          initial={{ scale: 1.04 }}
          whileInView={{ scale: 1 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 1.4, ease: [0.23, 1, 0.32, 1] }}
        />
      ) : (
        <div className="absolute inset-0">{children}</div>
      )}
    </motion.figure>
  );
}

/**
 * An interface fragment shown far larger than life and allowed to run off the edge of the frame.
 *
 * This is the honest substitute for a hero screenshot: the parts are real components with real vocabulary and no
 * invented records, and printing one at three times its working size is a composition rather than a claim. The
 * crop off the right edge is deliberate, so the band reads as a window onto the product instead of a picture of
 * it centred on a card.
 */
export function Oversized({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={cn('relative', className)}
      initial={{ opacity: 0, x: 24 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}
