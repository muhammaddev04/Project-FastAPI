import { Building2, Check, Store } from 'lucide-react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { OrgType } from '@/shared/auth/types';
import { ChoiceCard, ChoiceGroup } from '@/shared/ui';

const OPTIONS: { type: OrgType; icon: typeof Building2; key: 'company' | 'store' }[] = [
  { type: 'COMPANY', icon: Building2, key: 'company' },
  { type: 'STORE', icon: Store, key: 'store' },
];

/**
 * Company vs Store, the one question of step 3: shared choice tiles with the TZ description and the two or
 * three things each side does on the platform. The `compact` prop that hid the points is gone; it existed for
 * the registration form, which no longer asks this.
 */
export function OrgTypeChoice({ selected, field, legend }: { selected: OrgType; field: UseFormRegisterReturn; legend: string }) {
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
          title={t(`onboarding.${key}.title`)}
          description={t(`onboarding.${key}.description`)}
        >
          <ul className="space-y-1.5 border-t pt-3 text-label text-muted-foreground">
            {(t(`onboarding.${key}.points`, { returnObjects: true }) as string[]).map((point) => (
              <li key={point} className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </ChoiceCard>
      ))}
    </ChoiceGroup>
  );
}
