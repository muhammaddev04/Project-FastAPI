import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AuthButton } from '../components/AuthButton';
import { BrandMark } from '../components/BrandMark';
import { useAuthStore } from '../lib/auth-store';

export function WelcomePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  return <main className="welcome-page"><header className="welcome-header"><BrandMark compact /><button className="icon-button" aria-label="Sign out" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}><LogOut size={18} /></button></header><section className="welcome-content"><div className="welcome-avatar"><UserRound size={24} /></div><p className="auth-heading__kicker">Your account is ready</p><h1>Welcome, {user?.full_name.split(' ')[0]}.</h1><p>Your TezFarmo identity is secure. The next workspace layer will appear here once your business profile is connected.</p><div className="welcome-note"><ShieldCheck size={18} /><span>Signed in as <strong>{user?.phone}</strong></span></div><AuthButton type="button" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>Sign out securely</AuthButton></section></main>;
}
