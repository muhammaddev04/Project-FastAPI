import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { cloneElement, isValidElement, useEffect, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { Label } from './label';

type FieldControlProps = { id?: string; invalid?: boolean; 'aria-describedby'?: string };

/**
 * Label + control + hint/error wired together for screen readers (FND-035 FormField).
 * A new validation error gives the control a short shake and slides its message in.
 */
export function FormField({
  label,
  hint,
  error,
  action,
  labelClassName,
  size = 'md',
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  action?: ReactNode;
  labelClassName?: string;
  /** `lg`: the larger label of the sign-in forms. */
  size?: 'md' | 'lg';
  children: ReactElement<FieldControlProps>;
}) {
  const generated = useId();
  const id = (isValidElement(children) && children.props.id) || generated;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const controls = useAnimationControls();

  useEffect(() => {
    if (error) void controls.start({ x: [0, -5, 5, -3, 3, 0], transition: { duration: 0.32 } });
  }, [error, controls]);

  return (
    <div className={cn('space-y-2', size === 'lg' && '2xl:space-y-3')}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className={cn(size === 'lg' && 'text-body-lg font-medium 2xl:text-lg', labelClassName)}>
          {label}
        </Label>
        {action}
      </div>
      <motion.div animate={controls}>{cloneElement(children, { id, invalid: Boolean(error), 'aria-describedby': describedBy })}</motion.div>
      <AnimatePresence mode="wait" initial={false}>
        {error ? (
          <motion.p
            key="error"
            id={`${id}-error`}
            role="alert"
            className={cn('text-label text-danger', size === 'lg' && '2xl:text-body-lg')}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
          >
            {error}
          </motion.p>
        ) : hint ? (
          <motion.p
            key="hint"
            id={`${id}-hint`}
            className={cn('px-0.5 text-label text-muted-foreground', size === 'lg' && '2xl:text-body-lg')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
