import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { useAuthMethod } from './use-auth-method';

/** Google's standard "G" mark, as required by its sign-in branding guidelines. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * "Continue with Google". The OAuth flow (authorization code + state + PKCE, server-side exchange)
 * is owned by the backend; until /meta reports it as enabled the button stays disabled and explains why.
 */
export function GoogleButton() {
  const { t } = useTranslation();
  const { available, meta } = useAuthMethod('google');
  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="ghost"
        block
        className="h-[3.25rem] gap-3 rounded-2xl border border-slate-200 bg-white text-[0.9375rem] font-semibold text-slate-800 shadow-[0_6px_18px_-10px_rgba(15,27,58,0.35)] hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_26px_-12px_rgba(15,27,58,0.45)] active:translate-y-0 disabled:hover:translate-y-0 sm:h-14 short:h-12 short:sm:h-12 [&_svg]:!size-5"
        disabled={!available}
        aria-describedby="google-status"
      >
        <GoogleMark />
        {t('auth.google.button')}
      </Button>
      {!available && !meta.isPending ? (
        <p id="google-status" className="text-center text-2xs text-muted-foreground">
          {t('auth.google.notEnabled')}
        </p>
      ) : null}
    </div>
  );
}

/** "— OR VIA —" rule with the label in a small pill (screenshots). */
export function OrDivider({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="my-5 flex items-center gap-3 short:my-2.5" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span className="rounded-full border border-border bg-subtle/70 px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label ?? t('auth.shell.orVia')}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
