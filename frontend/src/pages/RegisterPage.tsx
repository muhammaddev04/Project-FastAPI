import { AlertCircle, CheckCircle2, Phone, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthButton } from '../components/AuthButton';
import { AuthDivider } from '../components/AuthDivider';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';
import { GoogleButton } from '../components/GoogleButton';
import { PasswordField } from '../components/PasswordField';
import { RoleSelector } from '../components/RoleSelector';
import { apiFetch, friendlyAuthError } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import type { AccountRole, AuthResponse } from '../lib/types';

type Step = 'contact' | 'verify' | 'profile';

export function RegisterPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [step, setStep] = useState<Step>('contact');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [registrationToken, setRegistrationToken] = useState('');
  const [debugCode, setDebugCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<AccountRole>('COMPANY');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  async function startRegistration(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return setError('Enter a valid phone number with country code.');
    try {
      setBusy(true);
      const result = await apiFetch<{ debug_code?: string }>('/api/v1/auth/register/start', { method: 'POST', body: JSON.stringify({ phone }) });
      setDebugCode(result.debug_code ?? ''); setStep('verify');
    } catch (cause) { setError(friendlyAuthError(cause)); } finally { setBusy(false); }
  }

  async function verifyRegistration(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (!/^\d{6}$/.test(code)) return setError('Enter the six-digit verification code.');
    try {
      setBusy(true);
      const result = await apiFetch<{ registration_token: string }>('/api/v1/auth/register/verify', { method: 'POST', body: JSON.stringify({ phone, code }) });
      setRegistrationToken(result.registration_token); setStep('profile');
    } catch (cause) { setError(friendlyAuthError(cause)); } finally { setBusy(false); }
  }

  async function completeRegistration(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (fullName.trim().length < 2) return setError('Enter your full name.');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return setError('Use at least 8 characters with letters and numbers.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    try {
      setBusy(true);
      const result = await apiFetch<AuthResponse>('/api/v1/auth/register/complete', { method: 'POST', body: JSON.stringify({ registration_token: registrationToken, full_name: fullName.trim(), password, language: 'en', role }) });
      setSession(result); setSuccess('Your TezFarmo account is ready.');
      setTimeout(() => navigate('/app', { replace: true }), 650);
    } catch (cause) { setError(friendlyAuthError(cause)); } finally { setBusy(false); }
  }

  async function continueWithGoogle() {
    setError('');
    try { setGoogleBusy(true); const result = await apiFetch<{ authorization_url: string }>('/api/v1/auth/google/start'); window.location.assign(result.authorization_url); }
    catch (cause) { setError(friendlyAuthError(cause)); setGoogleBusy(false); }
  }

  return <AuthLayout eyebrow="Start with the right route" title="Build a better way to supply." subtitle="Choose how your business works, then invite your supply network when you are ready.">
    <div className="auth-page">
      <div className="auth-heading"><p className="auth-heading__kicker">Create your workspace</p><h2>Join TezFarmo</h2><p>{step === 'contact' ? 'It takes less than two minutes to get started.' : step === 'verify' ? 'A quick check keeps your account secure.' : 'Tell us how your business buys or supplies.'}</p></div>
      <div className="stepper" aria-label={`Registration step ${step === 'contact' ? 1 : step === 'verify' ? 2 : 3} of 3`}><span className="stepper__active">01</span><i /><span className={step !== 'contact' ? 'stepper__active' : ''}>02</span><i /><span className={step === 'profile' ? 'stepper__active' : ''}>03</span></div>
      {error ? <div className="auth-alert" role="alert"><AlertCircle size={17} /> <span>{error}</span></div> : null}
      {success ? <div className="auth-alert auth-success" role="status"><CheckCircle2 size={17} /> <span>{success}</span></div> : null}
      {step === 'contact' ? <form className="auth-form" onSubmit={startRegistration} noValidate><FormField id="register-phone" label="Phone number" name="phone" type="tel" placeholder="+992 00 000 0000" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} icon={<Phone size={16} />} /><AuthButton type="submit" busy={busy}>Continue</AuthButton></form> : null}
      {step === 'verify' ? <form className="auth-form" onSubmit={verifyRegistration} noValidate><FormField id="register-code" label="Verification code" name="code" inputMode="numeric" maxLength={6} placeholder="000000" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} hint={debugCode ? `Development code: ${debugCode}` : 'Check the code sent to your phone.'} /><AuthButton type="submit" busy={busy}>Verify phone</AuthButton><button className="text-button text-button--center" type="button" onClick={() => setStep('contact')}>Use a different number</button></form> : null}
      {step === 'profile' ? <form className="auth-form" onSubmit={completeRegistration} noValidate><FormField id="register-name" label="Full name" name="full_name" placeholder="Your name" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} icon={<UserRound size={16} />} /><RoleSelector value={role} onChange={setRole} /><PasswordField id="register-password" label="Create password" name="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} hint="At least 8 characters, with letters and numbers." /><PasswordField id="register-confirm-password" label="Confirm password" name="confirm_password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><AuthButton type="submit" busy={busy}>{busy ? 'Creating account...' : 'Create account'}</AuthButton></form> : null}
      {step === 'contact' ? <><AuthDivider /><GoogleButton busy={googleBusy} onClick={continueWithGoogle} /></> : null}
      <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
    </div>
  </AuthLayout>;
}
