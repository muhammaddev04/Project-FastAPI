import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Six separate digit boxes that behave as one field: typing advances, Backspace goes back,
 * arrows move, and pasting a code fills every box. Exposes one labelled group for screen readers.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  label,
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  label: string;
  invalid?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? '');
  const focus = (index: number) => refs.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  const setAt = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join('').slice(0, length));
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index]) {
      event.preventDefault();
      setAt(index - 1, '');
      focus(index - 1);
    } else if (event.key === 'ArrowLeft') focus(index - 1);
    else if (event.key === 'ArrowRight') focus(index + 1);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    focus(pasted.length);
  };

  return (
    <div role="group" aria-label={label} className="grid grid-cols-6 gap-2 sm:gap-3">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`${label} ${index + 1}`}
          aria-invalid={invalid || undefined}
          placeholder="·"
          onPaste={onPaste}
          onKeyDown={(event) => onKeyDown(index, event)}
          onChange={(event) => {
            const typed = event.target.value.replace(/\D/g, '').slice(-1);
            setAt(index, typed);
            if (typed) focus(index + 1);
          }}
          className={cn(
            'h-14 w-full rounded border bg-subtle text-center font-data text-xl font-bold text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60',
            'focus:border-primary focus:bg-surface focus:shadow-[inset_0_0_0_1px_hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-70',
            invalid ? 'border-danger' : 'border-transparent',
          )}
        />
      ))}
    </div>
  );
}
