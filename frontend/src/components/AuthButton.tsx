import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function AuthButton({ children, busy, variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; busy?: boolean; variant?: 'primary' | 'secondary' }) {
  return <button className={`auth-button auth-button--${variant}`} disabled={busy || props.disabled} {...props}>{busy ? <span className="auth-button__spinner" aria-hidden="true" /> : null}{busy ? 'Please wait...' : children}</button>;
}
