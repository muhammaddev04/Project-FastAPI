import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronRight, Clock3, Menu, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { VerificationBanner } from '@/features/verification/verification-banner';
import { InvitationsBadge } from '@/features/team/invitations';
import { AccountMenu } from '@/shared/auth/account-menu';
import type { Area } from '@/shared/auth/context';
import type { Me, Membership } from '@/shared/auth/types';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { ThemeSwitcher } from '@/shared/theme/theme-switcher';
import { BrandMark, Button, SupportLink } from '@/shared/ui';
import { NotificationsButton } from './notifications-button';
import { navByAvailability, type NavItem } from './nav-config';
import { OrgSwitcher } from './org-switcher';

/** A link of the sidebar; `phase` marks modules that a later TZ part delivers. */
export type ShellLink = { key: string; to: string; end?: boolean; icon: LucideIcon; label: string; phase?: string };
export type ShellSection = { key: string; label: string; links: ShellLink[] };

/**
 * Sidebar entry. The active row is a solid plate, drawn statically.
 *
 * It used to be a `layoutId` spring that slid between rows on every navigation, so the plate animated across
 * the sidebar while the page beneath it was still mounting. That drew the eye to the chrome at the moment
 * the content needed it, and kept framer-motion on the shell's critical path.
 */
function SidebarLink({ link, onNavigate }: { link: ShellLink; onNavigate?: () => void }) {
  const Icon = link.icon;
  return (
    <NavLink
      to={link.to}
      end={link.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-label transition-colors duration-fast',
          isActive
            ? 'bg-primary-strong font-medium text-primary-foreground shadow-sm'
            : 'text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">{link.label}</span>
    </NavLink>
  );
}

/**
 * The roadmap, kept apart from working navigation (C8).
 *
 * A native `<details>`, so it is keyboard operable and collapsed by default with no state of its own. Each
 * entry still links to its placeholder page, which states what the module will do and when, so the roadmap
 * stays discoverable without competing with what works today.
 */
export function PlannedGroup({ links, onNavigate }: { links: ShellLink[]; onNavigate?: () => void }) {
  const { t } = useTranslation();
  if (links.length === 0) return null;
  return (
    <details className="group border-t border-sidebar-border pt-3">
      <summary className="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-caption text-sidebar-muted transition-colors duration-fast hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">{t('shell.plannedGroup')}</span>
        <span className="font-numeric opacity-70">{links.length}</span>
        <ChevronRight className="size-3.5 shrink-0 transition-transform duration-fast group-open:rotate-90" aria-hidden="true" />
      </summary>
      <p className="px-2.5 pb-1 pt-2 text-caption text-sidebar-muted/80">{t('shell.plannedGroupHint')}</p>
      <div className="space-y-0.5">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.key}
              to={link.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex h-8 items-center gap-2.5 rounded-xl px-2.5 text-caption transition-colors duration-fast',
                  isActive ? 'bg-sidebar-active text-sidebar-foreground' : 'text-sidebar-muted/80 hover:text-sidebar-foreground',
                )
              }
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate">{link.label}</span>
              <span className="font-numeric text-micro opacity-60">{link.phase}</span>
            </NavLink>
          );
        })}
      </div>
    </details>
  );
}

export function SidebarNav({
  sections,
  footer,
  onNavigate,
}: {
  sections: ShellSection[];
  /** The roadmap group, rendered after the working navigation. */
  footer?: ReactNode;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('shell.mainNavigation')} className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.key}>
          {/* Group labels organise the list; they are not entries in it, so they stop shouting. */}
          <p className="mb-1.5 px-2.5 text-caption font-medium text-sidebar-muted">{section.label}</p>
          <div className="space-y-0.5">
            {section.links.map((link) => (
              <SidebarLink key={link.key} link={link} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
      {footer}
    </nav>
  );
}

/** Sidebar content: brand lockup with the area tag (the "B2B NETWORK" tag of the sign-in header), context, nav. */
export function SidebarBody({
  areaLabel,
  context,
  sections,
  navFooter,
  onNavigate,
}: {
  areaLabel: string;
  context?: ReactNode;
  sections: ShellSection[];
  navFooter?: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className={cn('flex h-14 shrink-0 items-center justify-between gap-2 px-4', onNavigate && 'pr-14')}>
        <BrandMark size="xs" />
        {/* Which area this is, stated plainly. It was an uppercase outlined pill competing with the mark. */}
        <span className="truncate text-caption font-medium text-sidebar-muted">{areaLabel}</span>
      </div>
      {context ? <div className="px-3 pb-1">{context}</div> : null}
      <SidebarNav sections={sections} footer={navFooter} onNavigate={onNavigate} />
      <div className="border-t border-sidebar-border px-5 py-4">
        <SupportLink tone="inverted" />
      </div>
    </>
  );
}

export type Crumb = { label: string; to?: string };

/**
 * Frame shared by every signed-in area (FND-032): fixed sidebar on desktop, a Radix drawer on phones (focus
 * trapped, Escape closes), a sticky header carrying location, and the page content.
 *
 * The header no longer prints the page title. It used to, while every page also rendered a `PageHeader` with
 * the same string, so each screen opened with its own name twice in two different sizes. The header now owns
 * *where you are* (the breadcrumb trail) and the page owns *what this is* (its heading). That also let the
 * header come down from 64px to 56px, which is a row of table data given back on every screen.
 */
export function ShellFrame({
  areaLabel,
  context,
  sections,
  navFooter,
  crumbs,
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
  /** Roadmap group, rendered under the working navigation. */
  navFooter?: ReactNode;
  crumbs: Crumb[];
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
    <div className="workspace relative min-h-screen bg-background">
      {hideSidebar ? null : (
        <aside className="chrome fixed inset-y-0 left-0 z-30 hidden w-[17rem] flex-col border-y-0 border-l-0 border-r text-sidebar-foreground lg:flex">
          <SidebarBody areaLabel={areaLabel} context={context} sections={sections} navFooter={navFooter} />
        </aside>
      )}

      {hideSidebar ? null : (
        <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade bg-foreground/50 backdrop-blur-[2px] lg:hidden" />
            <DialogPrimitive.Content
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                (event.currentTarget as HTMLElement | null)?.focus();
              }}
              tabIndex={-1}
              className="chrome fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[85vw] animate-fade flex-col border-y-0 border-l-0 border-r text-sidebar-foreground shadow-pop focus:outline-none lg:hidden"
            >
              <DialogPrimitive.Title className="sr-only">{t('shell.mainNavigation')}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">{areaLabel}</DialogPrimitive.Description>
              <SidebarBody
                areaLabel={areaLabel}
                context={context}
                sections={sections}
                navFooter={navFooter}
                onNavigate={() => setDrawerOpen(false)}
              />
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-sidebar-border px-4 py-3">
                <LanguageSwitcher />
                <ThemeSwitcher />
              </div>
              <DialogPrimitive.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-3 size-9 text-sidebar-muted"
                  aria-label={t('shell.closeMenu')}
                >
                  <X />
                </Button>
              </DialogPrimitive.Close>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}

      <div className={cn('relative', !hideSidebar && 'lg:pl-[17rem]')}>
        <header className="chrome sticky top-0 z-20 flex h-14 items-center gap-2 border-x-0 border-t-0 border-b px-3 sm:gap-3 sm:px-6 lg:px-8">
          {hideSidebar ? null : (
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('shell.openMenu')} onClick={() => setDrawerOpen(true)}>
              <Menu />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            {/*
              Breadcrumbs at every width. On a phone only the current page shows, because the ancestors would
              consume the whole bar; from `sm` the full trail appears. The last crumb is the current page and
              carries `aria-current`, so this is the location indicator at all sizes.
            */}
            <nav aria-label={t('shell.breadcrumb')}>
              <ol className="flex min-w-0 items-center gap-1 text-label text-muted-foreground">
                {crumbs.map((crumb, index) => {
                  const last = index === crumbs.length - 1;
                  return (
                    <li key={`${crumb.label}-${index}`} className={cn('min-w-0 items-center gap-1', last ? 'flex' : 'hidden sm:flex')}>
                      {index > 0 ? <ChevronRight className="hidden size-3 shrink-0 opacity-60 sm:block" aria-hidden="true" /> : null}
                      {crumb.to && !last ? (
                        <Link to={crumb.to} className="truncate transition-colors duration-fast hover:text-primary">
                          {crumb.label}
                        </Link>
                      ) : (
                        <span className={cn('truncate', last && 'font-medium text-foreground')} aria-current={last ? 'page' : undefined}>
                          {crumb.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
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
      <InvitationsBadge />
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
  // Working navigation and the roadmap are built separately, so the sidebar answers "what can I do now".
  const { available, planned } = navByAvailability(area, membership);
  const sections: ShellSection[] = available.map((section) => ({
    key: section.key,
    label: t(`nav.sections.${section.key}`),
    links: toLinks(area, section.items, t),
  }));
  // Breadcrumbs and the mobile tab bar still need to resolve a planned path opened directly.
  const items = [...available.flatMap((section) => section.items), ...planned];
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
        'chrome fixed inset-x-0 bottom-0 z-20 grid border-x-0 border-b-0 border-t pb-[env(safe-area-inset-bottom)]',
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
                'relative flex h-16 flex-col items-center justify-center gap-1 text-micro transition-colors',
                isActive ? 'font-bold text-primary' : 'font-medium text-muted-foreground hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Static marker: the tab bar is a destination list, not something to animate between. */}
                {isActive ? <span aria-hidden="true" className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" /> : null}
                <Icon className="size-5" strokeWidth={isActive ? 2.1 : 1.8} aria-hidden="true" />
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
      navFooter={<PlannedGroup links={toLinks(area, planned, t)} />}
      crumbs={crumbs}
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
