import { CheckCircle2, Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { passwordRules } from './schemas';

type Level = 0 | 1 | 2 | 3;

function strength(password: string): Level {
  if (!password) return 0;
  const rules = passwordRules(password);
  if (!rules.length || !rules.letter || !rules.digit) return 1;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^\p{L}\d]/u].filter((pattern) => pattern.test(password)).length;
  return password.length >= 12 && variety >= 3 ? 3 : 2;
}

const BAR: Record<Level, string> = { 0: 'w-0', 1: 'w-1/4 bg-danger', 2: 'w-3/5 bg-warning', 3: 'w-full bg-primary' };
const TEXT: Record<Level, string> = { 0: 'text-muted-foreground', 1: 'text-danger', 2: 'text-warning', 3: 'text-primary' };

/** Live IAM-003 panel: strength verdict, bar and rules. The server remains the authority (weak_password). */
export function PasswordChecklist({ password }: { password: string }) {
  const { t } = useTranslation();
  const rules = passwordRules(password);
  const level = strength(password);
  const verdict = ['', t('auth.password.weak'), t('auth.password.fair'), t('auth.password.strong')][level];
  const items = [
    { key: 'length', met: rules.length },
    { key: 'letterDigit', met: rules.letter && rules.digit },
  ];
  return (
    <div className="space-y-2 rounded bg-subtle px-3 py-2.5" aria-live="polite">
      <div className="flex items-center justify-between text-[0.8125rem] font-semibold">
        <span>{t('auth.password.strengthTitle')}</span>
        <span className={TEXT[level]}>{verdict}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn('h-full rounded-full transition-[width,background-color] duration-300', BAR[level])} />
      </div>
      <ul className="grid grid-cols-2 gap-2 pt-0.5 text-[0.875rem]">
        {items.map((item) => (
          <li key={item.key} className={cn('flex items-center gap-2', item.met ? 'text-primary' : 'text-muted-foreground')}>
            {item.met ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Circle className="size-4" aria-hidden="true" />}
            <span>{t(`auth.password.rules.${item.key}`)}</span>
            <span className="sr-only">{item.met ? t('auth.password.met') : t('auth.password.notMet')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
