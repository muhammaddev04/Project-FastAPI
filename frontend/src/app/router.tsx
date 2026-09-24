import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { WelcomePage } from '@/features/onboarding/welcome-page';
import { useMe } from '@/shared/auth/api';
import { homePath } from '@/shared/auth/context';
import { RequireAuth } from '@/shared/auth/guards';
import { useSessionStore } from '@/shared/auth/session-store';
import { ForbiddenPage, NotFoundPage } from './status-pages';

/** `/`: signed-in users go to their application (or onboarding); everyone else to sign-in. */
function RootRedirect() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  const me = useMe();
  if (!accessToken) return <Navigate to="/login" replace />;
  if (!me.data) return <RequireAuth />;
  return <Navigate to={homePath(me.data, activeOrgId)} replace />;
}

/** FND-031 route table. */
export const routes: RouteObject[] = [
  { path: '/', element: <RootRedirect /> },
  { path: '/welcome', element: <RequireAuth>{(me) => <WelcomePage me={me} />}</RequireAuth> },
  { path: '/403', element: <ForbiddenPage /> },
  { path: '/404', element: <NotFoundPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
