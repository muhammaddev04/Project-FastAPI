/**
 * Which Google flow the browser is in when it returns to /auth/google/callback (the only redirect URI registered
 * with Google). It only picks the page's behaviour; the server decides validity from its own transaction record
 * (purpose + user + browser binding), so tampering with this value cannot link or sign in anything.
 */
const KEY = 'tezfarmo.googleIntent';
export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';

export function markGoogleLink(): void {
  try {
    sessionStorage.setItem(KEY, 'link');
  } catch {
    /* storage unavailable: the callback then treats the return as a sign-in and the server refuses it */
  }
}

export function isGoogleLinkReturn(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'link';
  } catch {
    return false;
  }
}

export function clearGoogleIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
