import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCompleteGoogleLink } from '@/features/profile/google-link-api';
import type { GoogleLinkResult } from '@/features/profile/connected-accounts';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { clearGoogleIntent, isGoogleLinkReturn } from '@/shared/auth/google-intent';
import { useSessionStore } from '@/shared/auth/session-store';
import { Alert, Button, Spinner } from '@/shared/ui';
import { goToGoogle, useGoogleSignIn } from './api';
import { AuthActions, AuthPage } from './auth-layout';

type Returned = { code: string | null; state: string | null; error: string | null };

/** Codes that no retry can fix: the user has to take a different route in. */
const TERMINAL = ['oauth_account_exists', 'user_blocked', 'oauth_email_not_verified'];

function Waiting({ text }: { text: string }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border bg-subtle/60 px-4 py-3.5 text-body text-foreground">
      <Spinner className="size-4 text-primary" />
      {text}
    </div>
  );
}

/**
 * Google redirects back here with `code` + `state` (or `error`), for a sign-in or, when the signed-in user
 * started "Connect Google" on /profile, for linking. Code and state are read once, removed from the address bar
 * and handed to the matching backend endpoint, which checks that the transaction really is of that kind.
 *
 * Phase D did not touch any of that. What changed is that each outcome now says what to do next: a cancelled
 * consent offers both Google and the password form, a transport failure offers a retry, and the one case that
 * is neither (the address already belongs to a password account) says so and sends the user to /login instead
 * of offering a retry that would fail identically.
 */
export function GoogleCallbackPage() {
  const [params, setParams] = useSearchParams();
  const [returned] = useState<Returned>(() => ({ code: params.get('code'), state: params.get('state'), error: params.get('error') }));
  const [linking] = useState(isGoogleLinkReturn);

  const urlHasSecrets = ['code', 'state', 'error', 'scope', 'authuser', 'prompt', 'hd'].some((key) => params.has(key));
  useEffect(() => {
    if (urlHasSecrets) setParams(new URLSearchParams(), { replace: true });
  }, [urlHasSecrets, setParams]);

  // The link view navigates away itself; it waits until the address bar is clean so the two navigations never race.
  return linking ? <LinkCallback returned={returned} urlClean={!urlHasSecrets} /> : <SignInCallback returned={returned} />;
}

function SignInCallback({ returned }: { returned: Returned }) {
  const { t } = useTranslation();
  const signIn = useGoogleSignIn();
  const sent = useRef(false);
  const { mutate } = signIn;
  const usable = Boolean(returned.code && returned.state && !returned.error);

  useEffect(() => {
    // The code works once: the ref also survives StrictMode's double effect.
    if (!usable || sent.current) return;
    sent.current = true;
    mutate({ code: returned.code!, state: returned.state! });
  }, [usable, mutate, returned]);

  const failure = !usable ? (returned.error === 'access_denied' ? 'cancelled' : 'broken') : signIn.isError ? 'failed' : null;
  const code = signIn.error instanceof ApiError ? signIn.error.code : null;
  const conflict = code === 'oauth_account_exists';

  return (
    <AuthPage title={t('auth.google.callbackTitle')} lead={failure ? undefined : t('auth.google.callbackSubtitle')}>
      {failure === 'cancelled' ? (
        <Alert tone="warning" title={t('auth.google.cancelledTitle')}>
          {t('auth.google.cancelledText')}
        </Alert>
      ) : failure === 'broken' ? (
        <Alert tone="danger" title={t('auth.google.failedTitle')}>
          {t('errors.oauth_failed')}
        </Alert>
      ) : failure === 'failed' ? (
        <Alert tone={conflict ? 'warning' : 'danger'} title={conflict ? t('auth.google.conflictTitle') : t('auth.google.failedTitle')}>
          {conflict ? t('auth.google.conflictText') : errorMessage(signIn.error, t)}
        </Alert>
      ) : (
        <Waiting text={t('auth.google.signingIn')} />
      )}
      {failure ? (
        <AuthActions className="mt-6">
          {/* An address that already has a password account signs in with it; nothing else is worth a retry. */}
          {code && TERMINAL.includes(code) ? null : (
            <Button type="button" block size="xl" onClick={goToGoogle}>
              {t('auth.google.tryAgain')}
            </Button>
          )}
          <Button
            asChild
            variant={code && TERMINAL.includes(code) ? 'primary' : 'ghost'}
            block
            size={code && TERMINAL.includes(code) ? 'xl' : 'lg'}
          >
            <Link to="/login">{conflict ? t('auth.google.signInWithPassword') : t('auth.reset.back')}</Link>
          </Button>
        </AuthActions>
      ) : null}
    </AuthPage>
  );
}

/** "Connect Google" return: needs the signed-in user (restored from the refresh cookie after the trip to Google). */
function LinkCallback({ returned, urlClean }: { returned: Returned; urlClean: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accessToken = useSessionStore((state) => state.accessToken);
  const restoring = useSessionStore((state) => state.restoring);
  const complete = useCompleteGoogleLink();
  const sent = useRef(false);
  const { mutate } = complete;
  const usable = Boolean(returned.code && returned.state && !returned.error);

  useEffect(() => {
    if (returned.error && urlClean) {
      // Cancelled on Google's screen (or refused there): back to the profile, nothing changed. The profile clears
      // the link marker on arrival, so the guest guard never bounces this page mid-way.
      const state: GoogleLinkResult = { googleLink: 'cancelled' };
      navigate('/profile', { replace: true, state });
    }
  }, [returned.error, urlClean, navigate]);

  useEffect(() => {
    if (!usable || !accessToken || sent.current) return;
    sent.current = true;
    mutate(
      { code: returned.code!, state: returned.state! },
      {
        onSuccess: (link) => {
          const state: GoogleLinkResult = { googleLink: link.status === 'already_linked' ? 'already_linked' : 'linked' };
          navigate('/profile', { replace: true, state });
        },
      },
    );
  }, [usable, accessToken, mutate, returned, navigate]);

  // A guest is never redirected by the guard, so the marker can go now.
  const signedOut = usable && !restoring && !accessToken && !complete.isPending;
  useEffect(() => {
    if (signedOut) clearGoogleIntent();
  }, [signedOut]);

  const problem = complete.isError
    ? errorMessage(complete.error, t)
    : signedOut
      ? t('auth.google.linkSignedOut')
      : !usable && !returned.error
        ? t('errors.oauth_failed')
        : null;

  return (
    <AuthPage title={t('auth.google.linkTitle')}>
      {problem ? (
        <Alert tone="danger" title={t('auth.google.linkFailedTitle')}>
          {problem}
        </Alert>
      ) : (
        <Waiting text={t('auth.google.linking')} />
      )}
      {problem ? (
        <Button asChild block size="xl" className="mt-6">
          <Link to={signedOut ? '/login' : '/profile'} replace onClick={clearGoogleIntent}>
            {signedOut ? t('auth.register.signIn') : t('auth.google.backToProfile')}
          </Link>
        </Button>
      ) : null}
    </AuthPage>
  );
}
