import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// findBy*/waitFor default to 1 s; on a loaded machine running the whole suite in parallel that is too tight.
configure({ asyncUtilTimeout: 10000 });

/**
 * jsdom has no IntersectionObserver, and the public site's section reveals (framer-motion `whileInView`) ask
 * for one on mount. This stub reports every observed element as visible straight away, which is the right
 * behaviour for a test: the reveal is an entrance animation, so the assertions want its finished state.
 */
class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [0];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
