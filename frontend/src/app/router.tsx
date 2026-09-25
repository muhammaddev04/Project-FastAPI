import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AuthShell } from '@/features/auth/auth-layout';
import { GoogleCallbackPage } from '@/features/auth/google-callback-page';
import { LoginPage } from '@/features/auth/login-page';
import { RegisterPage } from '@/features/auth/register-page';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { VerifyEmailPage } from '@/features/auth/verify-email-page';
import { CompanyDashboard } from '@/features/dashboard/company-dashboard';
import { CourierHome } from '@/features/dashboard/courier-home';
import { StoreDashboard } from '@/features/dashboard/store-dashboard';
import { PlannedModulePage } from '@/features/modules/planned-module-page';
import { WelcomePage } from '@/features/onboarding/welcome-page';
import { ProfilePage } from '@/features/profile/profile-page';
import { TeamPage } from '@/features/team/team-page';
import { useMe } from '@/shared/auth/api';
import { homePath } from '@/shared/auth/context';
import { RequireAuth, RequireGuest } from '@/shared/auth/guards';
import { useSessionStore } from '@/shared/auth/session-store';
import { AreaLayout } from './shell/area-layout';
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
  {
    // Auth layout route: the brand panel stays mounted while the card animates between pages.
    element: <RequireGuest><AuthShell /></RequireGuest>,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/auth/google/callback', element: <GoogleCallbackPage /> },
    ],
  },
  // CR-001: recovery starts with email; the old SMS-era path points there.
  { path: '/reset', element: <Navigate to="/forgot-password" replace /> },
  { path: '/welcome', element: <RequireAuth>{(me) => <WelcomePage me={me} />}</RequireAuth> },
  { path: '/profile', element: <RequireAuth>{(me) => <ProfilePage me={me} />}</RequireAuth> },
  {
    path: '/company',
    element: <AreaLayout area="company" />,
    children: [
      { index: true, element: <CompanyDashboard /> },
      { path: 'team', element: <TeamPage /> },
      { path: ':module', element: <PlannedModulePage /> },
    ],
  },
  {
    path: '/store',
    element: <AreaLayout area="store" />,
    children: [
      { index: true, element: <StoreDashboard /> },
      { path: 'team', element: <TeamPage /> },
      { path: ':module', element: <PlannedModulePage /> },
    ],
  },
  {
    path: '/courier',
    element: <AreaLayout area="courier" />,
    children: [
      { index: true, element: <CourierHome /> },
      { path: ':module', element: <PlannedModulePage /> },
    ],
  },
  { path: '/403', element: <ForbiddenPage /> },
  { path: '/404', element: <NotFoundPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
