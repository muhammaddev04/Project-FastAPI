import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AuthShell } from '@/features/auth/auth-layout';
import { GoogleCallbackPage } from '@/features/auth/google-callback-page';
import { LoginPage } from '@/features/auth/login-page';
import { RegisterPage } from '@/features/auth/register-page';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { VerifyEmailPage } from '@/features/auth/verify-email-page';
import { CompanyDashboard } from '@/features/dashboard/company-dashboard';
import { CourierHome } from '@/features/dashboard/courier-home';
import { StoreDashboard } from '@/features/dashboard/store-dashboard';
import { PlannedModulePage } from '@/features/modules/planned-module-page';
import { VerificationsPage } from '@/features/admin/verifications-page';
import { OrganizationProfilePage } from '@/features/organization/organization-profile-page';
import { BusinessSetupPage } from '@/features/onboarding/business-setup-page';
import { BusinessTypePage } from '@/features/onboarding/business-type-page';
import { VerificationPage } from '@/features/verification/verification-page';
import { ProfilePage } from '@/features/profile/profile-page';
import { TeamPage } from '@/features/team/team-page';
import { useMe } from '@/shared/auth/api';
import { homePath, onboardingPath, usableMemberships } from '@/shared/auth/context';
import { RequireAuth, RequireGuest, RequireSuperadmin } from '@/shared/auth/guards';
import { useSessionStore } from '@/shared/auth/session-store';
import { AdminLayout, AdminPlannedPage } from './shell/admin-layout';
import { AreaLayout } from './shell/area-layout';
import { ForbiddenPage, NotFoundPage } from './status-pages';

/** `/`: signed-in users go to their application (or onboarding); everyone else to sign-in. */
function RootRedirect() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const restoring = useSessionStore((state) => state.restoring);
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  const me = useMe();
  if (!accessToken && !restoring) return <Navigate to="/login" replace />;
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
      // Phase D steps 1 and 2. `/verify-email` is the pre-Phase-D address of step 2 and renders the same page,
      // so the links already in people's inboxes and bookmarks keep working.
      { path: '/register', element: <RegisterPage /> },
      { path: '/register/verify', element: <VerifyEmailPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/auth/google/callback', element: <GoogleCallbackPage /> },
    ],
  },
  // CR-001: recovery starts with email and a 6-digit code; the old SMS-era path and the old reset-link page point there.
  { path: '/reset', element: <Navigate to="/forgot-password" replace /> },
  { path: '/reset-password', element: <Navigate to="/forgot-password" replace /> },
  /*
   * Phase D steps 3 and 4. The business type is a screen of its own, and the organization form is the screen
   * after it; both need a session, because `POST /organizations/*` does.
   *
   * P01 §10 / P02 §8 still holds: a user who registered before Phase D arrives with the type already on their
   * record and is sent straight to step 4, so the question is never asked twice.
   */
  {
    path: '/welcome',
    element: (
      <RequireAuth>
        {(me) =>
          usableMemberships(me).length === 0 && me.onboarding?.org_type ? <Navigate to={onboardingPath(me)} replace /> : <BusinessTypePage me={me} />
        }
      </RequireAuth>
    ),
  },
  { path: '/welcome/company', element: <RequireAuth>{(me) => <BusinessSetupPage me={me} type="COMPANY" />}</RequireAuth> },
  { path: '/welcome/store', element: <RequireAuth>{(me) => <BusinessSetupPage me={me} type="STORE" />}</RequireAuth> },
  { path: '/profile', element: <RequireAuth>{(me) => <ProfilePage me={me} />}</RequireAuth> },
  {
    path: '/admin',
    element: <RequireSuperadmin>{(me) => <AdminLayout me={me} />}</RequireSuperadmin>,
    children: [
      { index: true, element: <Navigate to="verifications" replace /> },
      { path: 'verifications', element: <VerificationsPage /> },
      { path: ':module', element: <AdminPlannedPage /> },
    ],
  },
  {
    path: '/company',
    element: <AreaLayout area="company" />,
    children: [
      { index: true, element: <CompanyDashboard /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'settings', element: <Navigate to="profile" replace /> },
      { path: 'settings/profile', element: <OrganizationProfilePage /> },
      { path: 'settings/verification', element: <VerificationPage /> },
      { path: ':module', element: <PlannedModulePage /> },
    ],
  },
  {
    path: '/store',
    element: <AreaLayout area="store" />,
    children: [
      { index: true, element: <StoreDashboard /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'settings', element: <Navigate to="profile" replace /> },
      { path: 'settings/profile', element: <OrganizationProfilePage /> },
      { path: 'settings/verification', element: <VerificationPage /> },
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
