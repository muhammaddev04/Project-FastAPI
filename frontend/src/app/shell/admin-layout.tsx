import { Activity, ClipboardCheck, Database, LayoutDashboard, ScrollText, Store, Users, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import type { Me } from '@/shared/auth/types';
import { Card, EmptyState, PageHeader, PhaseBadge } from '@/shared/ui';
import { HeaderTools, ShellFrame, type Crumb, type ShellSection } from './app-shell';
import type { AdminContext } from './use-admin-context';

/**
 * Administration menu (FND-032 AdminLayout). Only the screens the TZ names for /admin (P12 §5): the P02 verification
 * queue is built; the P12 screens are listed with their phase and open an honest "planned" page.
 */
type AdminItem = { key: string; icon: LucideIcon; phase?: 'P12' };
const REVIEW: AdminItem[] = [{ key: 'verifications', icon: ClipboardCheck }];
const PLATFORM: AdminItem[] = [
  { key: 'dashboard', icon: LayoutDashboard, phase: 'P12' },
  { key: 'users', icon: Users, phase: 'P12' },
  { key: 'organizations', icon: Store, phase: 'P12' },
  { key: 'audit', icon: ScrollText, phase: 'P12' },
  { key: 'ops', icon: Database, phase: 'P12' },
];
const ALL = [...REVIEW, ...PLATFORM];

export function AdminLayout({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const toLinks = (items: AdminItem[]) =>
    items.map((item) => ({ key: item.key, to: `/admin/${item.key}`, icon: item.icon, label: t(`nav.admin.${item.key}`), phase: item.phase }));
  const sections: ShellSection[] = [
    { key: 'review', label: t('nav.sections.review'), links: toLinks(REVIEW) },
    { key: 'platform', label: t('nav.sections.platform'), links: toLinks(PLATFORM) },
  ];
  const current = ALL.find((item) => pathname.startsWith(`/admin/${item.key}`)) ?? REVIEW[0]!;
  const crumbs: Crumb[] = [{ label: t('admin.eyebrow'), to: '/admin' }, { label: t(`nav.admin.${current.key}`) }];
  return (
    <ShellFrame
      areaLabel={t('shell.areas.admin')}
      context={
        <div className="flex items-center gap-3 rounded-2xl border bg-surface/60 p-2.5 dark:bg-subtle/50">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-deep to-brand-blue text-white">
            <Activity className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-label font-bold leading-4">{t('admin.eyebrow')}</span>
            <span className="mt-0.5 block truncate text-2xs text-sidebar-muted">SUPERADMIN</span>
          </span>
        </div>
      }
      sections={sections}
      crumbs={crumbs}
      title={t(`nav.admin.${current.key}`)}
      headerEnd={<HeaderTools me={me} notifications={false} />}
    >
      <Outlet context={{ me } satisfies AdminContext} />
    </ShellFrame>
  );
}

/** An /admin screen of P12 that is not built yet: what it will do and when, never sample data. */
export function AdminPlannedPage() {
  const { t } = useTranslation();
  const { module = '' } = useParams();
  const item = PLATFORM.find((candidate) => candidate.key === module);
  if (!item || !item.phase) return <Navigate to="/404" replace />;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('admin.eyebrow')}
        title={t(`nav.admin.${item.key}`)}
        description={t(`planned.admin.${item.key}`)}
        actions={<PhaseBadge phase={item.phase} />}
      />
      <Card className="relative overflow-hidden">
        <EmptyState icon={item.icon} title={t('planned.title', { phase: item.phase })} description={t('planned.description')} className="relative py-16 sm:py-20" />
      </Card>
    </div>
  );
}
