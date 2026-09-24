import { AlertCircle, Phone, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { roleHome } from '../lib/types';
import { AuthButton } from '../components/AuthButton';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';
import { RoleSelector } from '../components/RoleSelector';
import { apiFetch, friendlyAuthError } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import type { AccountRole, AuthResponse } from '../lib/types';

export function GoogleCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<AccountRole>('COMPANY');
  const [error, setError] = useState(params.get('error') ? 'Google sign-in was cancelled. You can return and try again.' : '');
  const [busy, setBusy] = useState(false);
  const code = params.get('code') ?? '';

  useEffect(() => { if (!code && !error) setError('Google did not return a sign-in code. Please try again.'); }, [code, error]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return setError('Enter a valid phone number with country code.');
    if (fullName.trim().length < 2) return setError('Enter your full name.');
    try {
      setBusy(true);
      const session = await apiFetch<AuthResponse>('/api/v1/auth/google/exchange', { method: 'POST', body: JSON.stringify({ code, phone, full_name: fullName.trim(), role }) });
      setSession(session); navigate(roleHome(session.user), { replace: true });
    } catch (cause) { setError(friendlyAuthError(cause)); } finally { setBusy(false); }
  }

  return <AuthLayout eyebrow="One secure connection" title="Finish your TezFarmo profile." subtitle="Google verified your identity. Add the business details we need to create your account.">
    <div className="auth-page"><div className="auth-heading"><p className="auth-heading__kicker">Google sign-in</p><h2>One last step</h2><p>Your phone keeps wholesale conversations reachable and secure.</p></div>{error ? <div className="auth-alert" role="alert"><AlertCircle size={17} /><span>{error}</span></div> : null}{code ? <form className="auth-form" onSubmit={submit} noValidate><FormField id="google-name" label="Full name" name="full_name" placeholder="Your name" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} icon={<UserRound size={16} />} /><FormField id="google-phone" label="Phone number" name="phone" type="tel" placeholder="+992 00 000 0000" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} icon={<Phone size={16} />} /><RoleSelector value={role} onChange={setRole} /><AuthButton type="submit" busy={busy}>{busy ? 'Connecting account...' : 'Finish with Google'}</AuthButton></form> : <AuthButton type="button" onClick={() => navigate('/login')}>Return to sign in</AuthButton>}</div>
  </AuthLayout>;
}
