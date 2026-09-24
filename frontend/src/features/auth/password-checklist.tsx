import { Check, Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { passwordRules, type PasswordRule } from './schemas';

const RULES: PasswordRule[] = ['length', 'letter', 'digit'];

function strength(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  const rules = passwordRules(password);
  const passed = RULES.filter((rule) => rules[rule]).length;
  if (passed < 3) return 1;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^\p{L}\d]/u].filter((pattern) => pattern.test(password)).length;
  return password.length >= 12 && variety >= 3 ? 3 : 2;
}

/** Live IAM-003 checklist with a simple strength hint. The server remains the authority (weak_password). */
export function PasswordChecklist({ password }: { password: string }) {
  const { t } = useTranslation();
  const rules = passwordRules(password);
  const level = strength(password);
  const labels = ['', t('auth.password.weak'), t('auth.password.fair'), t('auth.password.strong')];
  return (
    <div className="space-y-2.5" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-3 gap-1" aria-hidden="true">
          {[1, 2, 3].map((step) => (
            <span
              key={step}
              className={cn(
                'h-1 rounded-full transition-colors',
                level >= step ? (level === 1 ? 'bg-danger' : level === 2 ? 'bg-warning' : 'bg-success') : 'bg-muted',
              )}
            />
          ))}
        </div>
        <span className="w-14 text-right text-2xs font-medium text-muted-foreground">{labels[level]}</span>
      </div>
      <ul className="grid gap-1 text-[0.8125rem] sm:grid-cols-3">
        {RULES.map((rule) => (
          <li key={rule} className={cn('flex items-center gap-1.5', rules[rule] ? 'text-success' : 'text-muted-foreground')}>
            {rules[rule] ? <Check className="size-3.5" aria-hidden="true" /> : <Circle className="size-3" aria-hidden="true" />}
            <span>{t(`auth.password.rules.${rule}`)}</span>
            <span className="sr-only">{rules[rule] ? t('auth.password.met') : t('auth.password.notMet')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
