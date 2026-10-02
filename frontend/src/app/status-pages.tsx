import { Compass, ShieldX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { StandaloneLayout } from './shell/standalone-layout';

/** 403 / 404 in the sign-in language: gradient status code, icon tile, Montserrat title, brand action. */
function StatusPage({ code, icon: Icon, title, description }: { code: string; icon: LucideIcon; title: string; description: string }) {
  const { t } = useTranslation();
  return (
    <StandaloneLayout className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <div className="max-w-md animate-fade-in text-center">
        <p className="text-primary font-display text-[5.5rem] font-black leading-none tracking-tight sm:text-[7rem]">
          {code}
        </p>
        <span className="mx-auto -mt-2 mb-5 flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-[0_14px_30px_-18px_hsl(var(--primary)/0.8)]">
          <Icon className="size-6" aria-hidden="true" />
        </span>
        <h1 className="font-display text-2xl font-extrabold sm:text-display-sm">{title}</h1>
        <p className="mt-2 text-body-lg leading-relaxed text-muted-foreground">{description}</p>
        <Button asChild variant="primary" size="lg" className="mt-7">
          <Link to="/">{t('states.goHome')}</Link>
        </Button>
      </div>
    </StandaloneLayout>
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
