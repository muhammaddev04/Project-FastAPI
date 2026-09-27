import { AnimatePresence, motion } from 'framer-motion';
import { forwardRef, useCallback, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'maxLength'> & { length?: number; invalid?: boolean };

/**
 * One-time code field (e.g. the 6-digit email code): one real input (so typing, deleting, pasting "123 456",
 * SMS/email autofill, labels and form libraries all work as usual) laid over a row of digit slots that show the
 * value, the caret and focus. Digits only; anything else is dropped before the value reaches the form.
 */
export const CodeInput = forwardRef<HTMLInputElement, Props>(({ length = 6, invalid, className, onChange, onFocus, onBlur, disabled, ...props }, ref) => {
  const inner = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);

  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      inner.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const [typed, setValue] = useState('');
  // The form may reset or prefill the field without an input event, so the slots show the input's own value.
  const value = inner.current ? inner.current.value : typed;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, length);
    setValue(event.target.value);
    onChange?.(event);
  };

  const active = Math.min(value.length, length - 1);
  return (
    <div className={cn('relative', className)}>
      <div aria-hidden="true" className="grid gap-1.5 min-[360px]:gap-2 sm:gap-2.5" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
        {Array.from({ length }, (_, index) => {
          const digit = value[index];
          const current = focused && index === active && !(value.length === length && index === length - 1 && digit);
          return (
            <div
              key={index}
              className={cn(
                'relative flex h-12 items-center justify-center rounded-xl border bg-subtle font-data text-[1.25rem] font-bold text-foreground transition-[border-color,box-shadow,background-color] duration-200 min-[360px]:h-[3.25rem] sm:h-14 sm:text-[1.375rem] short:sm:h-12',
                invalid
                  ? 'border-danger'
                  : current || (focused && value.length === length && index === length - 1)
                    ? 'border-primary/70 shadow-[0_0_0_3px_hsl(var(--primary)/0.16)]'
                    : digit
                      ? 'border-primary/40 bg-primary/[0.06]'
                      : 'border-input',
                disabled && 'opacity-60',
              )}
            >
              <AnimatePresence initial={false}>
                {digit ? (
                  <motion.span
                    key={`${index}-${digit}`}
                    initial={{ opacity: 0, y: 6, scale: 0.85 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
                  >
                    {digit}
                  </motion.span>
                ) : current ? (
                  <span className="h-6 w-0.5 animate-caret rounded-full bg-primary" />
                ) : (
                  <span className="size-1.5 rounded-full bg-muted-foreground/45" />
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      <input
        ref={setRefs}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        // No maxLength: the browser would cut a pasted "code: 482913" to "code: " before the digits are kept.
        spellCheck={false}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        // Transparent text over the slots: 16px keeps iOS from zooming; the slots draw the digits and caret.
        className="absolute inset-0 h-full w-full cursor-text rounded-xl bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed"
        onChange={handleChange}
        onFocus={(event) => {
          setFocused(true);
          // Keep the caret at the end so typing always fills the next slot.
          const end = event.target.value.length;
          event.target.setSelectionRange(end, end);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...props}
      />
    </div>
  );
});
CodeInput.displayName = 'CodeInput';
