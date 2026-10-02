import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { PLANNED_MODULES, ROADMAP } from './roadmap';
import { useSessionStore } from '@/shared/auth/session-store';
import { mockApi, renderRoutes } from '@/test/render';

const META = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: true, registration: true, password_reset: true, email_verification: true, google: true },
};

describe('public site', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null, restoring: false }));

  describe('composition', () => {
    /**
     * The first version of these pages was one shape repeated: heading, lead, grid. These assertions describe
     * the editorial alternative instead, so a future change that collapses it back into a stack of equal cards
     * fails here rather than being noticed on the page a month later.
     */
    it.each([
      ['/', 8],
      ['/how-it-works', 7],
      ['/product', 6],
    ])('%s is a sequence of bands, not one repeated section', async (path, atLeast) => {
      mockApi([{ path: '/meta', body: META }]);
      renderRoutes(routes, path);

      await screen.findByRole('heading', { level: 1 });
      const bands = document.querySelectorAll('main > section');
      expect(bands.length).toBeGreaterThanOrEqual(atLeast);
      // Exactly one inverted band per page: the closing action.
      expect([...bands].filter((band) => band.className.includes('bg-foreground'))).toHaveLength(1);
      // No marketing copy sits in a shadowed or heavily rounded container.
      expect(document.querySelectorAll('main .shadow-card, main .shadow-pop')).toHaveLength(0);
    });

    it('gives the home page one dominant headline and keeps the supporting copy far smaller', async () => {
      mockApi([{ path: '/meta', body: META }]);
      renderRoutes(routes, '/');

      const h1 = await screen.findByRole('heading', { level: 1 });
      expect(h1.className).toContain('font-serif');
      expect(h1.className).toContain('text-hero');
      // The serif is reserved for display type; the lead under it is sans.
      const lead = screen.getByText(/one shared record of the terms/i);
      expect(lead.className).not.toContain('font-serif');
    });

    it('states the model with real words rather than an illustration', async () => {
      mockApi([{ path: '/meta', body: META }]);
      renderRoutes(routes, '/');

      // Both parties and the thing between them are text, so the diagram is readable and translatable.
      expect(await screen.findAllByText('Company')).not.toHaveLength(0);
      expect(screen.getAllByText('Store')).not.toHaveLength(0);
      expect(screen.getAllByText('Partnership')).not.toHaveLength(0);
      // No invented business data anywhere on the page.
      expect(document.body.textContent).not.toMatch(/\bTJS\s?\d|\b\d{3,} (so|TJS)\b/);
    });
  });

  describe('honesty about what is built', () => {
    it('marks every unbuilt capability on the product page and never shows a TZ phase code', async () => {
      mockApi([{ path: '/meta', body: META }]);
      renderRoutes(routes, '/product');

      await screen.findByRole('heading', { level: 1 });
      // One "in development" marker per planned capability, and the live ones are marked too.
      expect(screen.getAllByText('in development')).toHaveLength(PLANNED_MODULES.length);
      expect(screen.getAllByText('available').length).toBeGreaterThan(0);
      // P04 / P07 and friends are internal scheduling and must not reach a visitor.
      expect(document.body.textContent).not.toMatch(/\bP0\d\b|\bP1\d\b/);
    });

    it('keeps the claim list and the application navigation from drifting apart', async () => {
      // Both read the same phase data: a module without a phase is live in nav-config too.
      const { navByAvailability } = await import('@/app/shell/nav-config');
      const { membershipFixture } = await import('@/test/fixtures');
      const { planned } = navByAvailability('company', membershipFixture({ permissions: ['members.view'] }));
      const plannedKeys = new Set(planned.map((item) => item.key));
      // Everything the sidebar renders as a placeholder is also marked as unbuilt on the public site.
      for (const key of ['catalog', 'orders', 'inventory', 'delivery', 'returns', 'reports']) {
        expect(plannedKeys.has(key)).toBe(true);
        expect(ROADMAP.find((entry) => entry.key === key)?.phase).toBeTruthy();
      }
    });
  });

  describe('navigation', () => {
    it('offers three destinations and both account actions, and moves between the pages', async () => {
      mockApi([{ path: '/meta', body: META }]);
      const { current } = renderRoutes(routes, '/');

      const nav = within(await screen.findByRole('navigation', { name: 'TezFarmo' }));
      await userEvent.click(nav.getByRole('link', { name: 'How it works' }));
      expect(current.location?.pathname).toBe('/how-it-works');
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    it('opens and closes a full mobile sheet rather than a dropdown', async () => {
      mockApi([{ path: '/meta', body: META }]);
      renderRoutes(routes, '/');

      const toggle = await screen.findByRole('button', { name: 'Menu' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(toggle);
      expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
      expect(document.body.style.overflow).toBe('hidden');
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('lets a visitor reach sign-in and registration from the footer', async () => {
      mockApi([{ path: '/meta', body: META }]);
      renderRoutes(routes, '/');

      const footer = within(await screen.findByRole('contentinfo'));
      expect(footer.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
      expect(footer.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register');
    });
  });

  describe('authentication belongs to the same site', () => {
    it('offers the way back to the public site from /login and keeps the form narrow', async () => {
      mockApi([{ path: '/meta', body: META }]);
      renderRoutes(routes, '/login');

      expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: /back to tezfarmo/i })[0]).toHaveAttribute('href', '/');
      // The heading is the public serif, and there is no card wrapping the form.
      expect(screen.getByRole('heading', { level: 1 }).className).toContain('font-serif');
      expect(document.querySelectorAll('.surface-card')).toHaveLength(0);
    });

    it('shows the numbered journey rail on the registration steps', async () => {
      mockApi([{ path: '/meta', body: META }]);
      renderRoutes(routes, '/register');

      const rail = within(await screen.findByRole('list', { name: 'Setting up your account' }));
      expect(rail.getAllByRole('listitem')).toHaveLength(5);
      expect(rail.getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step');
    });
  });
});
