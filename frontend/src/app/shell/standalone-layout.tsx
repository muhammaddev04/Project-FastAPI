import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { BrandMark } from '@/shared/ui';
import { TopBar } from './top-bar';

/**
 * Frame for pages outside an organization area (account, onboarding, status pages): the shared chrome top bar over
 * the soft brand glow — the same chrome as the sign-in screens, without their hero.
 */
export function StandaloneLayout({
  children,
  back,
  actions,
  className,
}: {
  children: ReactNode;
  /** Back link shown before the brand (e.g. to the user's home). */
  back?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const brand = <BrandMark size="xs" />;
  return (
    <div className="workspace relative min-h-screen overflow-x-hidden bg-background">
      <TopBar
        start={
          back ? (
            <Link to={back} className="group inline-flex min-w-0 items-center gap-2.5 rounded-xl" aria-label={t('common.back')}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-surface/60 text-muted-foreground transition-colors group-hover:border-primary/50 group-hover:text-primary">
                <ArrowLeft className="size-4" aria-hidden="true" />
              </span>
              {brand}
            </Link>
          ) : (
            <Link to="/" aria-label={t('common.appName')} className="rounded-xl">
              {brand}
            </Link>
          )
        }
        end={actions}
      />
      <main className={cn('relative', className)}>{children}</main>
    </div>
  );
}
