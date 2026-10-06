import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { areaFor, areaHome, isUsable } from '@/shared/auth/context';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me, Membership } from '@/shared/auth/types';
import { cn } from '@/shared/lib/cn';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui';

function OrgGlyph({ membership, size = 'md' }: { membership: Membership; size?: 'xs' | 'md' }) {
  // CR-003: the signed company logo / store image when there is one; the kind's mark otherwise. Decorative - the name is next to it.
  return (
    <Avatar
      kind={membership.org_type === 'STORE' ? 'store' : 'company'}
      size={size}
      src={membership.logo_url}
      className={size === 'md' ? 'rounded-xl' : 'rounded-lg'}
    />
  );
}

/** P01 §10 org switcher: pick a membership -> X-Org-Id changes and the matching area opens. */
export function OrgSwitcher({ me, active }: { me: Me; active: Membership }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveOrg = useSessionStore((state) => state.setActiveOrg);
  const usable = me.memberships.filter(isUsable);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex w-full items-center gap-3 rounded-2xl border bg-surface/60 p-2.5 text-left transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-[0_12px_28px_-20px_hsl(var(--primary)/0.8)] focus-visible:ring-2 focus-visible:ring-ring dark:bg-subtle/50',
        )}
        aria-label={t('shell.switchOrganization')}
      >
        <OrgGlyph membership={active} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label font-bold leading-4">{active.org_name}</span>
          <span className="mt-0.5 block truncate text-2xs text-sidebar-muted">
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
              // Commit the destination and organization together so the old area's guard cannot select a fallback.
              flushSync(() => {
                setActiveOrg(membership.organization_id);
                navigate(areaHome(areaFor(membership)), { flushSync: true });
              });
            }}
          >
            <OrgGlyph membership={membership} size="xs" />
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
