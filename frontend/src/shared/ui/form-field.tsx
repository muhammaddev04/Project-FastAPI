import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { Label } from './label';

type FieldControlProps = { id?: string; invalid?: boolean; 'aria-describedby'?: string };

/** Label + control + hint/error wired together for screen readers (FND-035 FormField). */
export function FormField({
  label,
  hint,
  error,
  action,
  labelClassName,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  action?: ReactNode;
  labelClassName?: string;
  children: ReactElement<FieldControlProps>;
}) {
  const generated = useId();
  const id = (isValidElement(children) && children.props.id) || generated;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className={labelClassName}>
          {label}
        </Label>
        {action}
      </div>
      {cloneElement(children, { id, invalid: Boolean(error), 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[0.8125rem] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="px-0.5 text-[0.8125rem] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
