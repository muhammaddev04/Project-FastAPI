import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, type InputProps } from './input';

/**
 * Password field with a visibility toggle (Phase C4).
 *
 * The padlock that used to sit inside the field is gone: it restated the label and the dots. The toggle no
 * longer animates either, because a 150ms rotate-and-scale spring on the icon drew attention to the control
 * rather than to the password being revealed. `aria-pressed` carries the state, so the swap needs no motion
 * to be understood.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'trailing'>>((props, ref) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <Input
      ref={ref}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground [&_svg]:size-4"
          aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
          aria-pressed={visible}
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      }
      {...props}
    />
  );
});
PasswordInput.displayName = 'PasswordInput';
