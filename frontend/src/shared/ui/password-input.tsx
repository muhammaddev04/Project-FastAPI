import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, type InputProps } from './input';

export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'trailing'>>((props, ref) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <Input
      ref={ref}
      type={visible ? 'text' : 'password'}
      leading={props.variant === 'outline' ? undefined : <LockKeyhole />}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="rounded p-1 text-muted-foreground hover:text-foreground [&_svg]:size-4"
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
