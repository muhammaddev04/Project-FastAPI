import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { ForbiddenPage, NotFoundPage } from './status-pages';

/** FND-031 route table. Auth and area routes are added by their features. */
export const routes: RouteObject[] = [
  { path: '/403', element: <ForbiddenPage /> },
  { path: '/404', element: <NotFoundPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
