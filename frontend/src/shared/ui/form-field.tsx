import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Label } from './label';

type FieldControlProps = { id?: string; invalid?: boolean; 'aria-describedby'?: string; required?: boolean };

/**
 * Label, control and hint/error wired together for assistive technology (FND-035).
 *
 * Phase C4 removed two things. The control no longer shakes when validation fails: the message, the border
 * and `aria-invalid` already carry the state, and a 320ms horizontal jitter on a field someone is typing
 * into is motion that interrupts rather than informs. And framer-motion is gone from the form path, so a
 * message appearing costs a CSS fade instead of a JS animation on every keystroke-triggered revalidation.
 *
 * `requirement` marks the exception rather than the rule: in these forms most fields are required, so
 * "optional" is the useful label and a wall of asterisks is not.
 */
export function FormField({
  label,
  hint,
  error,
  action,
  labelClassName,
  requirement,
  size = 'md',
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  action?: ReactNode;
  labelClassName?: string;
  requirement?: 'required' | 'optional';
  /** `lg`: the larger label of the sign-in and onboarding forms. */
  size?: 'md' | 'lg';
  children: ReactElement<FieldControlProps>;
}) {
  const { t } = useTranslation();
  const generated = useId();
  const id = (isValidElement(children) && children.props.id) || generated;
  // The error replaces the hint, so only one of them is ever referenced.
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="workspace-form-field min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label htmlFor={id} className={cn(size === 'lg' && 'text-body-lg', labelClassName)}>
          {label}
          {requirement === 'optional' ? (
            <span className="ml-1.5 font-normal text-muted-foreground">{t('common.optional')}</span>
          ) : null}
          {requirement === 'required' ? (
            <span className="ml-1 text-danger" aria-hidden="true">
              *
            </span>
          ) : null}
        </Label>
        {action}
      </div>
      {cloneElement(children, {
        id,
        invalid: Boolean(error),
        'aria-describedby': describedBy,
        required: requirement === 'required' || children.props.required,
      })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="animate-fade-in text-label text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-label text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
