import { Menu, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';
import { AccountMenu } from '@/shared/auth/account-menu';
import type { Area } from '@/shared/auth/context';
import type { Me, Membership } from '@/shared/auth/types';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { Badge, BrandMark, Button } from '@/shared/ui';
import { navFor, type NavItem, type NavSection } from './nav-config';
import { OrgSwitcher } from './org-switcher';

function NavEntry({ area, item, onNavigate }: { area: Area; item: NavItem; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path ? `/${area}/${item.path}` : `/${area}`}
      end={!item.path}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors',
          isActive
            ? 'bg-sidebar-active text-sidebar-foreground'
            : 'text-sidebar-muted hover:bg-sidebar-active/60 hover:text-sidebar-foreground',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">{t(`nav.${area}.${item.key}`)}</span>
      {item.phase ? (
        <span className="rounded border border-sidebar-border px-1 text-[0.625rem] font-semibold uppercase tracking-wide text-sidebar-muted">
          {item.phase}
        </span>
      ) : null}
    </NavLink>
  );
}

function SidebarNav({ area, sections, onNavigate }: { area: Area; sections: NavSection[]; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('shell.mainNavigation')} className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.key}>
          <p className="mb-1.5 px-2.5 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-sidebar-muted/80">
            {t(`nav.sections.${section.key}`)}
          </p>
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <NavEntry key={item.key} area={area} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SidebarBody({
  area,
  me,
  membership,
  sections,
  onNavigate,
}: {
  area: Area;
  me: Me;
  membership: Membership;
  sections: NavSection[];
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
        <BrandMark inverted={area !== 'store'} />
        <Badge tone="neutral" className="border-sidebar-border bg-transparent text-sidebar-muted">
          {t(`shell.areas.${area}`)}
        </Badge>
      </div>
      <div className="border-b border-sidebar-border px-3 py-3">
        <OrgSwitcher me={me} active={membership} tone={area === 'store' ? 'default' : 'inverted'} />
      </div>
      <SidebarNav area={area} sections={sections} onNavigate={onNavigate} />
    </>
  );
}

/**
 * Area frame (FND-032). Company: dark console sidebar. Store: light frame with a bottom tab bar on mobile.
 * Courier: mobile-first with bottom tabs everywhere.
 */
export function AppShell({ area, me, membership, children }: { area: Area; me: Me; membership: Membership; children: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sections = navFor(area, membership);
  const tabs = sections.flatMap((section) => section.items).filter((item) => item.primary);
  const hasTabs = area !== 'company' && tabs.length > 0;

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div data-area={area} className="min-h-screen bg-background">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
          area === 'courier' ? 'hidden' : 'lg:flex',
        )}
      >
        <SidebarBody area={area} me={me} membership={membership} sections={sections} />
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t('shell.mainNavigation')}>
          <button
            type="button"
            className="absolute inset-0 bg-foreground/30 backdrop-blur-[1px]"
            aria-label={t('shell.closeMenu')}
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-fade-in flex-col bg-sidebar text-sidebar-foreground shadow-pop">
            <SidebarBody area={area} me={me} membership={membership} sections={sections} onNavigate={() => setDrawerOpen(false)} />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2.5 text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground"
              aria-label={t('shell.closeMenu')}
              onClick={() => setDrawerOpen(false)}
            >
              <X />
            </Button>
          </div>
        </div>
      ) : null}

      <div className={cn(area !== 'courier' && 'lg:pl-64')}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-surface/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-6">
          {area !== 'courier' ? (
            <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label={t('shell.openMenu')} onClick={() => setDrawerOpen(true)}>
              <Menu />
            </Button>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-semibold lg:hidden">{membership.org_name}</p>
          </div>
          <LanguageSwitcher />
          <AccountMenu me={me} />
        </header>

        <main className={cn('mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8', hasTabs && 'pb-24 lg:pb-8')}>{children}</main>
      </div>

      {hasTabs ? (
        <nav
          aria-label={t('shell.quickNavigation')}
          className={cn(
            'fixed inset-x-0 bottom-0 z-20 grid border-t bg-surface pb-[env(safe-area-inset-bottom)]',
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
                    'flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors',
                    isActive ? 'text-accent' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                <Icon className="size-5" aria-hidden="true" />
                {t(`nav.${area}.${item.key}`)}
              </NavLink>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
