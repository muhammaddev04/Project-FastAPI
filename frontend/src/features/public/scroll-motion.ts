import { useEffect, useRef } from 'react';

/** Animate the public copy on entry and gently turn photographs as they cross the viewport. */
export function useScrollMotion(route: string) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === 'undefined' || typeof Element.prototype.animate !== 'function') return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let dispose = () => {};

    const setup = () => {
      dispose();
      if (preference.matches) return;
      const seen = new WeakSet<Element>();
      const animations = new Set<Animation>();
      const media = new Map<HTMLElement, Animation>();
      const active = new Set<HTMLElement>();
      let frame = 0;
      let index = 0;
      const update = () => {
        frame = 0;
        for (const element of active) {
          const bounds = element.getBoundingClientRect();
          const progress = Math.max(0, Math.min(1, (innerHeight - bounds.top) / (innerHeight + bounds.height)));
          const animation = media.get(element);
          if (animation) animation.currentTime = progress * 1000;
        }
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(update);
      };
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const element = entry.target as HTMLElement;
            if (media.has(element)) {
              if (entry.isIntersecting) active.add(element);
              else active.delete(element);
              schedule();
            } else if (entry.isIntersecting) {
              const direction = Number(element.dataset.scrollDirection) || 1;
              const animation = element.animate(
                [
                  { opacity: 0, translate: '0 32px', rotate: `${direction * 3}deg` },
                  { opacity: 1, translate: '0 0', rotate: '0deg' },
                ],
                { duration: 850, delay: Number(element.dataset.scrollDelay) || 0, easing: 'cubic-bezier(.2,.75,.25,1)' },
              );
              animations.add(animation);
              animation.onfinish = () => animations.delete(animation);
              observer.unobserve(element);
            }
          }
        },
        { threshold: 0.12 },
      );
      const discover = () => {
        for (const element of root.querySelectorAll<HTMLElement>(
          'h1, h2, h3, p, main figure img, figure img, .day-page-hero-image, .day-hero-landscape, .day-sun, .day-feature-art > svg',
        )) {
          if (seen.has(element)) continue;
          seen.add(element);
          if (element.matches('img, .day-page-hero-image, .day-hero-landscape, svg')) {
            const icon = element.matches('svg');
            const animation = element.animate(
              [
                { translate: icon ? '0 8px' : '0 18px', rotate: icon ? '-35deg' : '-1.5deg', scale: icon ? '1' : '1.07' },
                { translate: icon ? '0 -8px' : '0 -18px', rotate: icon ? '35deg' : '1.5deg', scale: icon ? '1' : '1.07' },
              ],
              { duration: 1000, fill: 'both' },
            );
            animation.pause();
            media.set(element, animation);
          } else {
            element.dataset.scrollDirection = String(index % 2 ? -1 : 1);
            element.dataset.scrollDelay = String((index++ % 3) * 65);
          }
          observer.observe(element);
        }
      };
      discover();
      const mutations = new MutationObserver(discover);
      mutations.observe(root, { childList: true, subtree: true });
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      dispose = () => {
        observer.disconnect();
        mutations.disconnect();
        cancelAnimationFrame(frame);
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        for (const animation of animations) animation.cancel();
        for (const animation of media.values()) animation.cancel();
      };
    };
    setup();
    preference.addEventListener('change', setup);
    return () => {
      dispose();
      preference.removeEventListener('change', setup);
    };
  }, [route]);

  return ref;
}
