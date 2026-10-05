import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AuthShell } from '@/features/auth/auth-layout';
import { GoogleCallbackPage } from '@/features/auth/google-callback-page';
import { LoginPage } from '@/features/auth/login-page';
import { RegisterPage } from '@/features/auth/register-page';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { VerifyEmailPage } from '@/features/auth/verify-email-page';
import { CompanyDashboard } from '@/features/dashboard/company-dashboard';
import { ProductsPage } from '@/features/catalog/products-page';
import { ProductPage as CatalogProductPage } from '@/features/catalog/product-page';
import { CategoriesPage } from '@/features/catalog/categories-page';
import { PriceListsPage, PriceMatrixPage } from '@/features/catalog/pricing-pages';
import { ImportHistoryPage, ImportWizardPage } from '@/features/catalog/import-pages';
import { CourierHome } from '@/features/dashboard/courier-home';
import { StoreDashboard } from '@/features/dashboard/store-dashboard';
import { PlannedModulePage } from '@/features/modules/planned-module-page';
import { VerificationsPage } from '@/features/admin/verifications-page';
import { SubscriptionPage } from '@/features/subscriptions/subscription-page';
import {
  AdminSubscriptionsPage,
  AdminSubscriptionDetailPage,
  AdminPlansPage,
  AdminPlanRequestsPage,
} from '@/features/subscriptions/admin-pages';
import { OrganizationProfilePage } from '@/features/organization/organization-profile-page';
import { BusinessSetupPage } from '@/features/onboarding/business-setup-page';
import { BusinessTypePage } from '@/features/onboarding/business-type-page';
import { VerificationPage } from '@/features/verification/verification-page';
import { HomePage } from '@/features/public/home-page';
import { HowItWorksPage } from '@/features/public/how-it-works-page';
import { ProductPage } from '@/features/public/product-page';
import { PublicShell } from '@/features/public/public-shell';
import { SupportPage, SupportContent } from '@/features/support/support-page';
import { ProfilePage } from '@/features/profile/profile-page';
import { TeamPage } from '@/features/team/team-page';
import { InvitationsPage } from '@/features/team/invitations';
import { useMe } from '@/shared/auth/api';
import { homePath, onboardingPath, usableMemberships } from '@/shared/auth/context';
import { RequireAuth, RequireGuest, RequireSuperadmin } from '@/shared/auth/guards';
import { useSessionStore } from '@/shared/auth/session-store';
import { AdminLayout, AdminPlannedPage } from './shell/admin-layout';
import { AreaLayout } from './shell/area-layout';
import { ForbiddenPage, NotFoundPage } from './status-pages';

/**
 * `/`: the public homepage for visitors, their own application for signed-in users (Phase E).
 *
 * Before this, `/` sent everyone who was not signed in to /login, so there was no way to find out what
 * TezFarmo is without an account.
 *
 * The guest branch renders; it does not redirect. That is what makes a loop impossible here: a visitor at `/`
 * triggers no navigation at all, and `homePath` never returns `/` (it returns an area root, an onboarding step
 * or a verification page), so the signed-in branch cannot bounce back.
 *
 * The order of the checks is the session-restoration contract. `restoreSession` sets `restoring` only when the
 * readable CSRF cookie is present, so a visitor who has never signed in is never in that state and never waits
 * behind a loader; someone reloading with a live refresh cookie does wait, instead of being shown a marketing
 * page for a frame and then moved off it.
 */
function RootRoute() {
  const accessToken = useSessionStore((state) => state.accessToken);
  const restoring = useSessionStore((state) => state.restoring);
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  const me = useMe();
  if (!accessToken && !restoring) {
    return (
      <PublicShell>
        <HomePage />
      </PublicShell>
    );
  }
  // Still restoring, or signed in and /me has not answered: RequireAuth owns the loader and the retryable error.
  if (!me.data) return <RequireAuth />;
  return <Navigate to={homePath(me.data, activeOrgId)} replace />;
}

/** FND-031 route table. */
export const routes: RouteObject[] = [
  { path: '/', element: <RootRoute /> },
  // Phase E: the public site. Its own shell and its own (warm) palette; no session is required or assumed.
  {
    element: <PublicShell />,
    children: [
      { path: '/how-it-works', element: <HowItWorksPage /> },
      { path: '/product', element: <ProductPage /> },
    ],
  },
  {
    // Auth layout route: the brand panel stays mounted while the card animates between pages.
    element: (
      <RequireGuest>
        <AuthShell />
      </RequireGuest>
    ),
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
          usableMemberships(me).length === 0 && me.onboarding?.org_type ? (
            <Navigate to={onboardingPath(me)} replace />
          ) : (
            <BusinessTypePage me={me} />
          )
        }
      </RequireAuth>
    ),
  },
  { path: '/welcome/company', element: <RequireAuth>{(me) => <BusinessSetupPage me={me} type="COMPANY" />}</RequireAuth> },
  { path: '/welcome/store', element: <RequireAuth>{(me) => <BusinessSetupPage me={me} type="STORE" />}</RequireAuth> },
  { path: '/support', element: <RequireAuth>{(me) => <SupportPage me={me} />}</RequireAuth> },
  { path: '/profile', element: <RequireAuth>{(me) => <ProfilePage me={me} />}</RequireAuth> },
  { path: '/invitations', element: <RequireAuth>{(me) => <InvitationsPage me={me} />}</RequireAuth> },
  {
    path: '/admin',
    element: <RequireSuperadmin>{(me) => <AdminLayout me={me} />}</RequireSuperadmin>,
    children: [
      { index: true, element: <Navigate to="verifications" replace /> },
      { path: 'support', element: <SupportContent admin /> },
      { path: 'verifications', element: <VerificationsPage /> },
      { path: 'subscriptions', element: <AdminSubscriptionsPage /> },
      { path: 'subscriptions/:subscriptionId', element: <AdminSubscriptionDetailPage /> },
      { path: 'plans', element: <AdminPlansPage /> },
      { path: 'plan-requests', element: <AdminPlanRequestsPage /> },
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
      { path: 'settings/subscription', element: <SubscriptionPage /> },
      { path: 'subscription', element: <Navigate to="../settings/subscription" replace /> },
      { path: 'catalog', element: <Navigate to="products" replace /> },
      { path: 'catalog/products', element: <ProductsPage /> },
      { path: 'catalog/products/new', element: <CatalogProductPage /> },
      { path: 'catalog/products/:productId', element: <CatalogProductPage /> },
      { path: 'catalog/categories', element: <CategoriesPage /> },
      { path: 'pricing/lists', element: <PriceListsPage /> },
      { path: 'pricing/lists/:listId', element: <PriceMatrixPage /> },
      { path: 'imports', element: <ImportHistoryPage /> },
      { path: 'imports/new', element: <ImportWizardPage /> },
      { path: 'imports/:jobId', element: <ImportWizardPage /> },
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
