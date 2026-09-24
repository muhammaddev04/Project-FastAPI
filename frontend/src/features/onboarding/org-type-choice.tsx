import { Building2, Check, Store } from 'lucide-react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { OrgType } from '@/shared/auth/types';
import { cn } from '@/shared/lib/cn';

const OPTIONS: { type: OrgType; icon: typeof Building2; key: 'company' | 'store' }[] = [
  { type: 'COMPANY', icon: Building2, key: 'company' },
  { type: 'STORE', icon: Store, key: 'store' },
];

/** Company vs Store radio cards with the TZ description of each side (used by /welcome and /register). */
export function OrgTypeChoice({
  selected,
  field,
  legend,
  compact = false,
}: {
  selected: OrgType;
  field: UseFormRegisterReturn;
  legend: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <fieldset>
      <legend className="mb-3 text-[0.8125rem] font-medium">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(({ type, icon: Icon, key }) => {
          const active = selected === type;
          return (
            <label
              key={type}
              className={cn(
                'relative flex cursor-pointer flex-col gap-3 rounded-lg border bg-surface p-4 shadow-card transition-all',
                'focus-within:ring-2 focus-within:ring-ring',
                active ? 'border-primary ring-1 ring-primary' : 'hover:border-input',
              )}
            >
              <input type="radio" value={type} className="sr-only" {...field} />
              <span className="flex items-center justify-between">
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-md border',
                    active ? 'border-primary/20 bg-primary-soft text-primary' : 'bg-subtle text-muted-foreground',
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                  )}
                >
                  {active ? <Check className="size-3" /> : null}
                </span>
              </span>
              <span>
                <span className="block text-sm font-semibold">{t(`onboarding.${key}.title`)}</span>
                <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                  {t(`onboarding.${key}.description`)}
                </span>
              </span>
              {compact ? null : (
                <ul className="space-y-1 border-t pt-3 text-[0.8125rem] text-muted-foreground">
                  {(t(`onboarding.${key}.points`, { returnObjects: true }) as string[]).map((point) => (
                    <li key={point} className="flex gap-2">
                      <Check className="mt-1 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
