import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { areaFor, areaHome, isUsable } from '@/shared/auth/context';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me, Membership } from '@/shared/auth/types';
import { cn } from '@/shared/lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui';

function OrgGlyph({ membership, className }: { membership: Membership; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
        membership.org_type === 'COMPANY' ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground',
        className,
      )}
    >
      {membership.org_name.charAt(0).toUpperCase()}
    </span>
  );
}

/** P01 §10 org switcher: pick a membership -> X-Org-Id changes and the matching area opens. */
export function OrgSwitcher({ me, active, tone = 'default' }: { me: Me; active: Membership; tone?: 'default' | 'inverted' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveOrg = useSessionStore((state) => state.setActiveOrg);
  const usable = me.memberships.filter(isUsable);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          tone === 'inverted' ? 'hover:bg-sidebar-active' : 'hover:bg-muted',
        )}
        aria-label={t('shell.switchOrganization')}
      >
        <OrgGlyph membership={active} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8125rem] font-semibold leading-4">{active.org_name}</span>
          <span className={cn('block truncate text-2xs', tone === 'inverted' ? 'text-sidebar-muted' : 'text-muted-foreground')}>
            {t(`orgTypes.${active.org_type}`)} · {t(`roles.${active.role}`)}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('shell.organizations')}</DropdownMenuLabel>
        {usable.map((membership) => (
          <DropdownMenuItem
            key={membership.id}
            onSelect={() => {
              setActiveOrg(membership.organization_id);
              navigate(areaHome(areaFor(membership)));
            }}
          >
            <OrgGlyph membership={membership} className="size-6 text-2xs" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{membership.org_name}</span>
              <span className="block truncate text-2xs text-muted-foreground">
                {t(`orgTypes.${membership.org_type}`)} · {t(`roles.${membership.role}`)}
              </span>
            </span>
            {membership.id === active.id ? <Check className="!text-primary" aria-label={t('shell.current')} /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/welcome')}>
          <Plus /> {t('shell.newOrganization')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
