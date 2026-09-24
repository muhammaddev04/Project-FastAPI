import { ChevronsUpDown, LogOut, UserRound } from 'lucide-react';
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
          'flex items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        aria-label={t('account.menu')}
      >
        <Avatar name={me.full_name} />
        {compact ? null : (
          <>
            <span className="hidden min-w-0 sm:block">
              <span className="block truncate text-[0.8125rem] font-medium leading-4">{me.full_name}</span>
              <span className="block truncate text-2xs text-muted-foreground">{me.phone}</span>
            </span>
            <ChevronsUpDown className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('account.signedInAs')}</DropdownMenuLabel>
        <div className="px-2.5 pb-2 text-[0.8125rem]">
          <p className="truncate font-medium">{me.full_name}</p>
          <p className="truncate text-muted-foreground">{me.phone}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/profile')}>
          <UserRound /> {t('account.profile')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> {t('account.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
