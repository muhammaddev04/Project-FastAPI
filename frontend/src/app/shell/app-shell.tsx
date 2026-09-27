import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { ChevronRight, Menu, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { VerificationBanner } from '@/features/verification/verification-banner';
import { AccountMenu } from '@/shared/auth/account-menu';
import type { Area } from '@/shared/auth/context';
import type { Me, Membership } from '@/shared/auth/types';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { ThemeSwitcher } from '@/shared/theme/theme-switcher';
import { BrandMark, Button, SupportLink } from '@/shared/ui';
import { NotificationsButton } from './notifications-button';
import { navFor, type NavItem, type NavSection } from './nav-config';
import { OrgSwitcher } from './org-switcher';

/** A link of the sidebar; `phase` marks modules that a later TZ part delivers. */
export type ShellLink = { key: string; to: string; end?: boolean; icon: LucideIcon; label: string; phase?: string };
export type ShellSection = { key: string; label: string; links: ShellLink[] };

/** Sidebar entry: the active one sits on the sliding teal plate of the sign-in tabs. */
function SidebarLink({ link, plateId, onNavigate }: { link: ShellLink; plateId: string; onNavigate?: () => void }) {
  const Icon = link.icon;
  return (
    <NavLink
      to={link.to}
      end={link.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'relative flex h-10 items-center gap-3 rounded-xl px-3 text-[0.8125rem] font-semibold transition-colors',
          isActive ? 'text-white' : 'text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <motion.span
              layoutId={plateId}
              aria-hidden="true"
              className="absolute inset-0 rounded-xl bg-primary-strong shadow-glow-teal"
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            />
          ) : null}
          <Icon className="relative size-[1.125rem] shrink-0" aria-hidden="true" />
          <span className="relative flex-1 truncate">{link.label}</span>
          {link.phase ? (
            <span
              className={cn(
                'relative rounded-full border px-1.5 text-[0.5625rem] font-bold uppercase leading-4 tracking-wide',
                isActive ? 'border-white/40 text-white/85' : 'border-sidebar-border text-sidebar-muted',
              )}
            >
              {link.phase}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

export function SidebarNav({ sections, onNavigate }: { sections: ShellSection[]; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const plateId = useId();
  return (
    <nav aria-label={t('shell.mainNavigation')} className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {sections.map((section) => (
        <div key={section.key}>
          <p className="mb-2 px-3 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-sidebar-muted">{section.label}</p>
          <div className="space-y-1">
            {section.links.map((link) => (
              <SidebarLink key={link.key} link={link} plateId={plateId} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Sidebar content: brand lockup with the area tag (the "B2B NETWORK" tag of the sign-in header), context, nav. */
export function SidebarBody({
  areaLabel,
  context,
  sections,
  onNavigate,
}: {
  areaLabel: string;
  context?: ReactNode;
  sections: ShellSection[];
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className={cn('flex h-16 shrink-0 items-center justify-between gap-2 px-5', onNavigate && 'pr-14')}>
        <BrandMark />
        <span className="rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-[0.5625rem] font-bold uppercase leading-4 tracking-[0.12em] text-primary">
          {areaLabel}
        </span>
      </div>
      {context ? <div className="px-3 pb-1">{context}</div> : null}
      <SidebarNav sections={sections} onNavigate={onNavigate} />
      <div className="border-t border-sidebar-border px-5 py-4">
        <SupportLink tone="inverted" />
      </div>
    </>
  );
}

export type Crumb = { label: string; to?: string };

/**
 * Frame shared by every signed-in area (FND-032): fixed glass sidebar on desktop, a Radix drawer on phones
 * (focus trapped, Escape closes), a sticky glass header with breadcrumbs and title, the soft brand glow behind content.
 */
export function ShellFrame({
  areaLabel,
  context,
  sections,
  crumbs,
  title,
  headerEnd,
  banner,
  bottomNav,
  hideSidebar = false,
  mainClassName,
  children,
}: {
  areaLabel: string;
  context?: ReactNode;
  sections: ShellSection[];
  crumbs: Crumb[];
  title: string;
  headerEnd: ReactNode;
  banner?: ReactNode;
  bottomNav?: ReactNode;
  hideSidebar?: boolean;
  mainClassName?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className="relative min-h-screen bg-background">
      <div aria-hidden="true" className="brand-glow-soft pointer-events-none fixed inset-0" />

      {hideSidebar ? null : (
        <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-[17rem] flex-col border-y-0 border-l-0 border-r text-sidebar-foreground lg:flex">
          <SidebarBody areaLabel={areaLabel} context={context} sections={sections} />
        </aside>
      )}

      {hideSidebar ? null : (
        <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade bg-brand-navy/50 backdrop-blur-[2px] lg:hidden" />
            <DialogPrimitive.Content
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                (event.currentTarget as HTMLElement | null)?.focus();
              }}
              tabIndex={-1}
              className="glass fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[85vw] animate-fade flex-col border-y-0 border-l-0 border-r text-sidebar-foreground shadow-pop focus:outline-none lg:hidden">
              <DialogPrimitive.Title className="sr-only">{t('shell.mainNavigation')}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">{areaLabel}</DialogPrimitive.Description>
              <SidebarBody areaLabel={areaLabel} context={context} sections={sections} onNavigate={() => setDrawerOpen(false)} />
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" className="absolute right-2 top-3 size-9 text-sidebar-muted" aria-label={t('shell.closeMenu')}>
                  <X />
                </Button>
              </DialogPrimitive.Close>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}

      <div className={cn('relative', !hideSidebar && 'lg:pl-[17rem]')}>
        <header className="glass sticky top-0 z-20 flex h-16 items-center gap-2 border-x-0 border-t-0 border-b px-3 sm:gap-3 sm:px-6 lg:px-8">
          {hideSidebar ? null : (
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('shell.openMenu')} onClick={() => setDrawerOpen(true)}>
              <Menu />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <nav aria-label={t('shell.breadcrumb')} className="hidden sm:block">
              <ol className="flex min-w-0 items-center gap-1 text-[0.6875rem] font-semibold text-muted-foreground">
                {crumbs.map((crumb, index) => (
                  <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
                    {index > 0 ? <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden="true" /> : null}
                    {crumb.to ? (
                      <Link to={crumb.to} className="truncate transition-colors hover:text-primary">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="truncate" aria-current="page">
                        {crumb.label}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            <p className="truncate font-display text-[1.0625rem] font-bold leading-6 text-foreground sm:text-[1.125rem]">{title}</p>
          </div>
          {headerEnd}
        </header>

        <main className={cn('mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8', mainClassName)}>
          {banner}
          {children}
        </main>
      </div>

      {bottomNav}
    </div>
  );
}

/** Theme, language, notifications and account: the right side of every signed-in header. */
export function HeaderTools({ me, notifications = true }: { me: Me; notifications?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <ThemeSwitcher className="hidden bg-surface/50 md:inline-flex" />
      <LanguageSwitcher className="hidden bg-surface/50 sm:inline-flex" />
      {notifications ? <NotificationsButton /> : null}
      <AccountMenu me={me} compact />
    </div>
  );
}

/** Sub-pages that have their own label under a nav item (Settings › Profile). */
const SUBPAGES: Record<string, string> = {
  'settings/profile': 'orgProfile.tabs.profile',
  'settings/verification': 'orgProfile.tabs.verification',
};

function toLinks(area: Area, items: NavItem[], t: (key: string) => string): ShellLink[] {
  return items.map((item) => ({
    key: item.key,
    to: item.path ? `/${area}/${item.path}` : `/${area}`,
    end: !item.path,
    icon: item.icon,
    label: t(`nav.${area}.${item.key}`),
    phase: item.phase,
  }));
}

/**
 * Area frame for Company, Store and Courier (FND-032): the same shell everywhere; the area shows through its tag,
 * the organization switcher and its menu. Store and courier also get a bottom tab bar on phones.
 */
export function AppShell({ area, me, membership, children }: { area: Area; me: Me; membership: Membership; children: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navSections: NavSection[] = navFor(area, membership);
  const sections: ShellSection[] = navSections.map((section) => ({
    key: section.key,
    label: t(`nav.sections.${section.key}`),
    links: toLinks(area, section.items, t),
  }));
  const items = navSections.flatMap((section) => section.items);
  const tabs = items.filter((item) => item.primary);
  const hasTabs = area !== 'company' && tabs.length > 0;

  const relative = location.pathname.replace(`/${area}`, '').replace(/^\//, '');
  // Sub-pages (e.g. settings/verification) belong to their section's nav item.
  const current = items.find((item) => item.path === relative.split('/')[0]) ?? items[0];
  const currentLabel = t(`nav.${area}.${current?.key ?? 'dashboard'}`);
  const subpage = SUBPAGES[relative];
  const crumbs: Crumb[] = [
    { label: membership.org_name, to: `/${area}` },
    ...(current && current.path ? [{ label: currentLabel, to: subpage ? `/${area}/${current.path}` : undefined }] : []),
    ...(subpage ? [{ label: t(subpage) }] : []),
  ];
  if (crumbs.length === 1) crumbs[0] = { label: membership.org_name };

  const bottomNav = hasTabs ? (
    <nav
      aria-label={t('shell.quickNavigation')}
      className={cn(
        'glass fixed inset-x-0 bottom-0 z-20 grid border-x-0 border-b-0 border-t pb-[env(safe-area-inset-bottom)]',
        area === 'store' && 'lg:hidden',
      )}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.key}
            to={item.path ? `/${area}/${item.path}` : `/${area}`}
            end={!item.path}
            className={({ isActive }) =>
              cn(
                'relative flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] transition-colors',
                isActive ? 'font-bold text-primary' : 'font-medium text-muted-foreground hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <motion.span
                    layoutId="bottom-tab"
                    aria-hidden="true"
                    className="absolute inset-x-4 top-0 h-[3px] rounded-full bg-primary shadow-glow-teal"
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                  />
                ) : null}
                <Icon className="size-[1.375rem]" strokeWidth={isActive ? 2.1 : 1.8} aria-hidden="true" />
                <span className="max-w-full truncate px-1">{t(`nav.${area}.${item.key}`)}</span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  ) : null;

  return (
    <ShellFrame
      areaLabel={t(`shell.areas.${area}`)}
      context={<OrgSwitcher me={me} active={membership} />}
      sections={sections}
      crumbs={crumbs}
      title={subpage ? t(subpage) : currentLabel}
      headerEnd={<HeaderTools me={me} />}
      banner={<VerificationBanner area={area} membership={membership} />}
      bottomNav={bottomNav}
      hideSidebar={area === 'courier'}
      mainClassName={hasTabs ? (area === 'store' ? 'pb-28 lg:pb-8' : 'pb-28') : undefined}
    >
      {children}
    </ShellFrame>
  );
}
