/**
 * Atmosphere for the paper surface (Phase E4).
 *
 * The site was text and hairlines on flat cream, which reads as restrained the way an empty room reads as
 * minimal. These two give it depth without an asset and without decoration: both are procedural SVG, both are
 * `aria-hidden`, and neither animates.
 *
 * Deliberately not gradients. A gradient on a marketing page is the thing this redesign keeps deleting; grain
 * and rules are the properties of paper itself, which is the metaphor the canvas is already committed to.
 */

/**
 * Fine grain over the whole canvas, so the cream has a surface rather than being a fill.
 *
 * One fixed SVG with `feTurbulence`, multiplied at 2.5% and 4% at night. It costs one element and no request,
 * and it is what stops the large empty bands from looking like unpainted div.
 */
export function PaperGrain() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 opacity-[0.025] mix-blend-multiply dark:opacity-[0.04] dark:mix-blend-screen">
      <svg className="size-full" xmlns="http://www.w3.org/2000/svg">
        <filter id="tf-grain">
          {/* Fractal noise at a high frequency: visible as tooth, not as a pattern. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#tf-grain)" />
      </svg>
    </div>
  );
}

/**
 * A ruled field, for the band behind a statement: faint horizontal rules at the baseline rhythm, fading out
 * before they reach the text. It is the ledger paper the whole product is about, which is the one piece of
 * ornament here that means something.
 */
export function RuledField({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        backgroundImage: 'repeating-linear-gradient(to bottom, hsl(var(--border)) 0 1px, transparent 1px 2.5rem)',
        maskImage: 'radial-gradient(70% 60% at 50% 50%, transparent 20%, black 100%)',
        WebkitMaskImage: 'radial-gradient(70% 60% at 50% 50%, transparent 20%, black 100%)',
      }}
    />
  );
}
