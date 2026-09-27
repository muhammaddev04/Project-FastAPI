import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/shared/api/errors';
import { BrandMark, ErrorState, ForbiddenState, Spinner } from '@/shared/ui';
import { useMe } from './api';
import { areaFor, homePath, resolveActiveMembership, safeNextPath, type Area } from './context';
import { GOOGLE_CALLBACK_PATH, isGoogleLinkReturn } from './google-intent';
import { useSessionStore } from './session-store';
import type { Me, Membership } from './types';

function FullPageLoader() {
  const { t } = useTranslation();
  return (
    <div className="brand-glow-soft flex min-h-screen flex-col items-center justify-center gap-5 bg-background">
      <BrandMark size="md" />
      <Spinner className="size-5 text-primary" label={t('common.loading')} />
    </div>
  );
}

/** Loads /me for signed-in users; renders children with it. Unauthenticated users go to /login?next=… */
export function RequireAuth({ children }: { children?: (me: Me) => ReactNode }) {
  const location = useLocation();
  const accessToken = useSessionStore((state) => state.accessToken);
  const restoring = useSessionStore((state) => state.restoring);
  const me = useMe();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  useEffect(() => {
    if (!accessToken && !restoring) queryClient.removeQueries({ queryKey: ['me'] });
  }, [accessToken, restoring, queryClient]);

  // After a reload the session may still come back from the refresh cookie: wait before calling this a guest.
  if (!accessToken && restoring) return <FullPageLoader />;
  if (!accessToken) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (me.isPending) return <FullPageLoader />;
  if (me.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ErrorState message={errorMessage(me.error, t)} onRetry={() => void me.refetch()} />
      </div>
    );
  }
  return <>{children ? children(me.data) : <Outlet />}</>;
}

/**
 * Login/registration pages: a signed-in user is sent on, to the page that sent them to /login (`?next=`, same-app
 * paths only) or else to their application. This is also how a successful login leaves /login.
 */
export function RequireGuest({ children }: { children: ReactNode }) {
  const accessToken = useSessionStore((state) => state.accessToken);
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  const restoring = useSessionStore((state) => state.restoring);
  const [params] = useSearchParams();
  const location = useLocation();
  const me = useMe();
  if (restoring) return <FullPageLoader />;
  // A signed-in user returning from "Connect Google" must reach the callback page to finish the link.
  const linkReturn = location.pathname === GOOGLE_CALLBACK_PATH && isGoogleLinkReturn();
  if (accessToken && me.data && !linkReturn) {
    return <Navigate to={safeNextPath(params.get('next')) ?? homePath(me.data, activeOrgId)} replace />;
  }
  if (accessToken && me.isPending) return <FullPageLoader />;
  return <>{children}</>;
}

/** P02 §5 admin pages: SUPERADMIN only (the backend's `require_superadmin` decides; this only avoids a dead page). */
export function RequireSuperadmin({ children }: { children: (me: Me) => ReactNode }) {
  return <RequireAuth>{(me) => (me.is_superadmin ? children(me) : <Navigate to="/403" replace />)}</RequireAuth>;
}

export type AreaContext = { me: Me; membership: Membership };

/**
 * Area guard (P01 §10 RequireOrgType): the active membership must open this area. If the remembered
 * organization belongs to another area, the user is sent to that area rather than shown the wrong app.
 */
export function RequireArea({ area, children }: { area: Area; children: (context: AreaContext) => ReactNode }) {
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  const setActiveOrg = useSessionStore((state) => state.setActiveOrg);
  return (
    <RequireAuth>
      {(me) => {
        const active = resolveActiveMembership(me, activeOrgId);
        if (!active) return <Navigate to="/welcome" replace />;
        if (areaFor(active) !== area) {
          const inArea = me.memberships.find((membership) => membership.status === 'ACTIVE' && areaFor(membership) === area);
          if (!inArea) return <Navigate to="/403" replace />;
          return <SwitchTo orgId={inArea.organization_id} onSwitch={setActiveOrg} />;
        }
        if (active.organization_id !== activeOrgId) return <SwitchTo orgId={active.organization_id} onSwitch={setActiveOrg} />;
        return children({ me, membership: active });
      }}
    </RequireAuth>
  );
}

function SwitchTo({ orgId, onSwitch }: { orgId: string; onSwitch: (orgId: string) => void }) {
  useEffect(() => onSwitch(orgId), [orgId, onSwitch]);
  return <FullPageLoader />;
}

/** FE-004: hides a page from roles without the permission. The backend still enforces it. */
export function RequirePermission({ membership, code, children }: { membership: Membership; code: string; children: ReactNode }) {
  if (!membership.permissions.includes(code)) return <ForbiddenState className="py-24" />;
  return <>{children}</>;
}
