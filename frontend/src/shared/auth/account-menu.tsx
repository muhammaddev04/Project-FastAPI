import { ChevronsUpDown, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
import { useSignOut } from './sign-out';
import type { Me } from './types';

export function AccountMenu({ me, compact = false, className }: { me: Me; compact?: boolean; className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signOut = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex items-center gap-2 rounded-full p-0.5 text-left transition-shadow hover:shadow-[0_0_0_3px_hsl(var(--primary)/0.25)] focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        aria-label={t('account.menu')}
      >
        <Avatar name={me.full_name} size="md" src={me.avatar_url} />
        {compact ? null : (
          <>
            <span className="hidden min-w-0 sm:block">
              <span className="block truncate text-[0.8125rem] font-medium leading-4">{me.full_name}</span>
              <span className="block truncate text-2xs text-muted-foreground">{me.email}</span>
            </span>
            <ChevronsUpDown className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('account.signedInAs')}</DropdownMenuLabel>
        <div className="px-2.5 pb-2 text-[0.8125rem]">
          <p className="truncate font-medium">{me.full_name}</p>
          <p className="truncate text-muted-foreground">{me.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/profile')}>
          <UserRound /> {t('account.profile')}
        </DropdownMenuItem>
        {me.is_superadmin ? (
          <DropdownMenuItem onSelect={() => navigate('/admin/verifications')}>
            <ShieldCheck /> {t('account.verificationQueue')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> {t('account.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
