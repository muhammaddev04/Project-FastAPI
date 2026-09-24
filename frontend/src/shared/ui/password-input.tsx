import { AnimatePresence, motion } from 'framer-motion';
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
          className="relative flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground active:scale-90 [&_svg]:size-4"
          aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
          aria-pressed={visible}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={visible ? 'hide' : 'show'}
              initial={{ opacity: 0, rotate: -45, scale: 0.7 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 45, scale: 0.7 }}
              transition={{ duration: 0.15 }}
              className="flex"
            >
              {visible ? <EyeOff /> : <Eye />}
            </motion.span>
          </AnimatePresence>
        </button>
      }
      {...props}
    />
  );
});
PasswordInput.displayName = 'PasswordInput';
