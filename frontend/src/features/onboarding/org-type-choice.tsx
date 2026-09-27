import { Building2, Check, Store } from 'lucide-react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { OrgType } from '@/shared/auth/types';
import { ChoiceCard, ChoiceGroup } from '@/shared/ui';

const OPTIONS: { type: OrgType; icon: typeof Building2; key: 'company' | 'store' }[] = [
  { type: 'COMPANY', icon: Building2, key: 'company' },
  { type: 'STORE', icon: Store, key: 'store' },
];

/** Company vs Store choice on /welcome: shared choice tiles with the TZ description and points of each side. */
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
    <ChoiceGroup legend={legend} className="sm:grid-cols-2">
      {OPTIONS.map(({ type, icon, key }) => (
        <ChoiceCard
          key={type}
          field={field}
          value={type}
          selected={selected === type}
          icon={icon}
          entity={key}
          title={t(`onboarding.${key}.title`)}
          description={t(`onboarding.${key}.description`)}
        >
          {compact ? null : (
            <ul className="space-y-1.5 border-t pt-3 text-[0.8125rem] text-muted-foreground">
              {(t(`onboarding.${key}.points`, { returnObjects: true }) as string[]).map((point) => (
                <li key={point} className="flex gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          )}
        </ChoiceCard>
      ))}
    </ChoiceGroup>
  );
}
