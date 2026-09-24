import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { errorMessage } from '@/shared/api/errors';
import { BrandMark, ErrorState, ForbiddenState, Spinner } from '@/shared/ui';
import { useMe } from './api';
import { areaFor, homePath, resolveActiveMembership, type Area } from './context';
import { useSessionStore } from './session-store';
import type { Me, Membership } from './types';

function FullPageLoader() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <BrandMark />
      <Spinner className="size-5 text-muted-foreground" label={t('common.loading')} />
    </div>
  );
}

/** Loads /me for signed-in users; renders children with it. Unauthenticated users go to /login?next=… */
export function RequireAuth({ children }: { children?: (me: Me) => ReactNode }) {
  const location = useLocation();
  const accessToken = useSessionStore((state) => state.accessToken);
  const me = useMe();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  useEffect(() => {
    if (!accessToken) queryClient.removeQueries({ queryKey: ['me'] });
  }, [accessToken, queryClient]);

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

/** Login/registration pages: a signed-in user is sent to their application instead. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const accessToken = useSessionStore((state) => state.accessToken);
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  const me = useMe();
  if (accessToken && me.data) return <Navigate to={homePath(me.data, activeOrgId)} replace />;
  if (accessToken && me.isPending) return <FullPageLoader />;
  return <>{children}</>;
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
