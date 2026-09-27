import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { Area } from '@/shared/auth/context';
import type { Membership } from '@/shared/auth/types';
import { Alert, Button } from '@/shared/ui';
import { useOrganizationProfile } from './api';

/**
 * P02 §8 banner on every company/store page while the organization is not APPROVED (VER-006: partnerships need
 * verification). The status comes from GET /organization, so the UI never claims more than the server says.
 */
export function VerificationBanner({ area, membership }: { area: Area; membership: Membership }) {
  const { t } = useTranslation();
  const profile = useOrganizationProfile(membership.organization_id);
  const status = profile.data?.verification_status;
  if (area === 'courier' || !status || status === 'APPROVED') return null;
  const canOpen = membership.permissions.includes('verification.view');
  return (
    <Alert
      tone={status === 'REJECTED' ? 'danger' : 'warning'}
      className="mb-6"
      title={t(`verification.banner.${status}`)}
      action={
        canOpen ? (
          <Button asChild size="sm" variant="outline" className="bg-surface/60">
            <Link to={`/${area}/settings/verification`}>{t('verification.banner.open')}</Link>
          </Button>
        ) : undefined
      }
    >
      <span className="inline-flex items-center gap-1.5">
        <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
        {t('verification.banner.text')}
      </span>
    </Alert>
  );
}
