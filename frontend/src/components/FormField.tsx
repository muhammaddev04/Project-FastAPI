import type { InputHTMLAttributes, ReactNode } from 'react';

export function FormField({ label, error, hint, icon, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; icon?: ReactNode }) {
  const id = props.id ?? props.name;
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <div className={`form-field__control${error ? ' form-field__control--error' : ''}`}>
        {icon ? <span className="form-field__icon" aria-hidden="true">{icon}</span> : null}
        <input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...props} />
      </div>
      {error ? <p className="form-field__error" id={`${id}-error`} role="alert">{error}</p> : hint ? <p className="form-field__hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}
