import { FileText, Hash, KeyRound, MapPin, Phone, Settings, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAreaContext } from '@/app/shell/use-area-context';
import { useOrganizationProfile } from '@/features/verification/api';
import { useMembers } from '@/shared/auth/api';
import { areaFor } from '@/shared/auth/context';
import { Avatar, Button, MetaChip, Pill, ProfileHeader, StatCard, StatusBadge } from '@/shared/ui';

/**
 * Home hero of the Company/Store designs: the active organization from GET /organization (all roles have
 * `org.view`), falling back to the membership while it loads. Team size only for roles with `members.view`.
 */
export function OrgHero({ greeting }: { greeting: string }) {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const area = areaFor(membership);
  const isStore = membership.org_type === 'STORE';
  const profile = useOrganizationProfile(membership.organization_id).data;
  const canMembers = membership.permissions.includes('members.view');
  const members = useMembers(canMembers ? membership.organization_id : null, { limit: 1 });
  const status = profile?.verification_status ?? membership.verification_status ?? null;

  return (
    <ProfileHeader
      mark={
        <Avatar
          kind={isStore ? 'store' : 'company'}
          size="xl"
          verified={status === 'APPROVED'}
          src={profile ? profile.logo_url : membership.logo_url}
          alt={t(isStore ? 'images.storeImage.alt' : 'images.companyLogo.alt', { name: membership.org_name })}
        />
      }
      eyebrow={
        <>
          <Pill>{t(`shell.areas.${area}`)}</Pill>
          {status ? <StatusBadge kind="verification" value={status} /> : null}
        </>
      }
      title={membership.org_name}
      subtitle={greeting}
      chips={
        profile ? (
          <>
            <MetaChip icon={MapPin}>
              {profile.city}, {profile.address}
            </MetaChip>
            <MetaChip icon={Phone}>
              <span className="font-data">{profile.phone}</span>
            </MetaChip>
          </>
        ) : null
      }
      actions={
        membership.permissions.includes('org.edit_contacts') ? (
          <Button asChild variant="secondary" size="sm">
            <Link to={`/${area}/settings/profile`}>
              <Settings aria-hidden="true" /> {t('orgProfile.manage')}
            </Link>
          </Button>
        ) : null
      }
      stats={
        <>
          <StatCard icon={KeyRound} label={t('entity.yourRole')} value={t(`roles.${membership.role}`)} />
          {canMembers ? <StatCard icon={Users} label={t('entity.team')} value={members.data ? members.data.count : '…'} /> : null}
          {status ? <StatCard icon={FileText} label={t('entity.verification')} value={t(`verification.status.${status}`)} /> : null}
          {profile?.public_code ? (
            <StatCard
              icon={Hash}
              label={t('orgProfile.publicCode')}
              value={<span className="font-data tracking-widest">{profile.public_code}</span>}
            />
          ) : profile ? (
            <StatCard icon={MapPin} label={t('onboarding.fields.city')} value={profile.city} />
          ) : null}
        </>
      }
    />
  );
}
