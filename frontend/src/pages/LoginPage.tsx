import { AlertCircle, Phone } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthButton } from '../components/AuthButton';
import { AuthDivider } from '../components/AuthDivider';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';
import { GoogleButton } from '../components/GoogleButton';
import { PasswordField } from '../components/PasswordField';
import { apiFetch, friendlyAuthError } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import type { AuthResponse } from '../lib/types';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return setError('Enter a valid phone number with country code.');
    if (!password) return setError('Enter your password to continue.');
    try {
      setBusy(true);
      const session = await apiFetch<AuthResponse>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }) });
      setSession(session);
      navigate('/app', { replace: true });
    } catch (cause) {
      setError(friendlyAuthError(cause));
    } finally { setBusy(false); }
  }

  async function continueWithGoogle() {
    setError('');
    try {
      setGoogleBusy(true);
      const result = await apiFetch<{ authorization_url: string }>('/api/v1/auth/google/start');
      window.location.assign(result.authorization_url);
    } catch (cause) {
      setError(friendlyAuthError(cause));
      setGoogleBusy(false);
    }
  }

  return <AuthLayout eyebrow="The clear way to trade" title="Keep every order moving." subtitle="TezFarmo connects suppliers and stores in one calm, dependable workspace.">
    <div className="auth-page">
      <div className="auth-heading"><p className="auth-heading__kicker">Welcome back</p><h2>Sign in to TezFarmo</h2><p>Pick up where your business left off.</p></div>
      {error ? <div className="auth-alert" role="alert"><AlertCircle size={17} /> <span>{error}</span></div> : null}
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormField id="login-phone" label="Phone number" name="phone" type="tel" placeholder="+992 00 000 0000" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} icon={<Phone size={16} />} />
        <PasswordField id="login-password" label="Password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <div className="auth-form__meta"><span>Secure access for your team</span><button type="button" className="text-button" onClick={() => setError('Password reset will be available in the next auth iteration.')}>Forgot password?</button></div>
        <AuthButton type="submit" busy={busy}>{busy ? 'Signing in...' : 'Sign in'}</AuthButton>
      </form>
      <AuthDivider /><GoogleButton busy={googleBusy} onClick={continueWithGoogle} />
      <p className="auth-switch">Don't have an account? <Link to="/register">Create one</Link></p>
      <p className="auth-footer-note">By continuing, you agree to use TezFarmo for legitimate business activity.</p>
    </div>
  </AuthLayout>;
}
