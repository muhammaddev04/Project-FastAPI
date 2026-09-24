import { screen } from '@testing-library/react';
import { renderRoutes } from '@/test/render';
import { routes } from './router';

describe('router foundation (FND-031)', () => {
  it('renders a 404 page for unknown paths', () => {
    renderRoutes(routes, '/does-not-exist');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to start' })).toHaveAttribute('href', '/');
  });

  it('renders a 403 page', () => {
    renderRoutes(routes, '/403');
    expect(screen.getByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
  });
});
