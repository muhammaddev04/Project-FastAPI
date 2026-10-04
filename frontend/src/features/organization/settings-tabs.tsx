import { CreditCard, FileBadge2, IdCard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { areaFor } from '@/shared/auth/context';
import { LinkTabs } from '@/shared/ui';

/** Settings section tabs (P02 §8: profile and verification of the active organization). */
export function SettingsTabs() {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const base = `/${areaFor(membership)}/settings`;
  const tabs = [
    {
      to: `${base}/subscription`,
      icon: CreditCard,
      label: t('billing.title'),
      visible: membership.permissions.includes('subscription.view'),
    },
    { to: `${base}/profile`, icon: IdCard, label: t('orgProfile.tabs.profile'), visible: membership.permissions.includes('org.view') },
    {
      to: `${base}/verification`,
      icon: FileBadge2,
      label: t('orgProfile.tabs.verification'),
      visible: membership.permissions.includes('verification.view'),
    },
  ].filter((tab) => tab.visible);
  return <LinkTabs label={t('orgProfile.tabs.label')} items={tabs} className="workspace-settings-tabs" />;
}
