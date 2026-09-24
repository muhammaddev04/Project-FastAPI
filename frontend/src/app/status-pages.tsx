import { Compass, ShieldX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BrandMark, Button } from '@/shared/ui';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';

function StatusPage({ code, icon: Icon, title, description }: { code: string; icon: LucideIcon; title: string; description: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5">
        <Link to="/" aria-label={t('common.appName')}>
          <BrandMark />
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="max-w-md animate-fade-in text-center">
          <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl border bg-surface text-muted-foreground shadow-card">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{code}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-[0.8125rem] text-muted-foreground">{description}</p>
          <Button asChild variant="secondary" className="mt-6">
            <Link to="/">{t('states.goHome')}</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return <StatusPage code="404" icon={Compass} title={t('states.notFoundTitle')} description={t('states.notFoundDescription')} />;
}

export function ForbiddenPage() {
  const { t } = useTranslation();
  return <StatusPage code="403" icon={ShieldX} title={t('states.forbiddenTitle')} description={t('states.forbiddenDescription')} />;
}
