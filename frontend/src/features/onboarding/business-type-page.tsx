import { ArrowRight } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AuthFrame } from '@/features/auth/auth-frame';
import { AuthPage } from '@/features/auth/auth-layout';
import { AccountMenu } from '@/shared/auth/account-menu';
import { areaFor, areaHome, isUsable } from '@/shared/auth/context';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me, OrgType } from '@/shared/auth/types';
import { Avatar, Badge, Button } from '@/shared/ui';
import { OrgTypeChoice } from './org-type-choice';
import { InvitationsInbox, InvitationsBadge } from '@/features/team/invitations';

/**
 * Step 3 of 5: how will you use TezFarmo? (Phase D)
 *
 * This question used to be the first field of the registration form, asked of a stranger who did not yet have
 * an account, and then repeated as the first field of the organization form. It is now a screen of its own with
 * nothing else on it, asked once, at the point where the answer does something: it decides which endpoint
 * creates the organization, `POST /organizations/companies` or `POST /organizations/stores`.
 *
 * Users who registered before Phase D arrive with `onboarding.org_type` already set and never see this screen;
 * the router sends them straight to step 4 for that type.
 */
export function BusinessTypePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveOrg = useSessionStore((state) => state.setActiveOrg);
  const form = useForm<{ type: OrgType }>({ defaultValues: { type: 'COMPANY' } });
  const selected = form.watch('type');
  const existing = me.memberships.filter(isUsable);

  return (
    <AuthFrame
      step="type"
      actions={
        <>
          <InvitationsBadge />
          <AccountMenu me={me} compact />
        </>
      }
    >
      <AuthPage title={t('onboarding.type.title')} lead={t('onboarding.type.lead')}>
        <InvitationsInbox compact />
        <form className="space-y-6" onSubmit={form.handleSubmit(({ type }) => navigate(`/welcome/${type.toLowerCase()}`))}>
          <OrgTypeChoice selected={selected} field={form.register('type')} legend={t('onboarding.type.legend')} />
          <Button type="submit" block size="xl">
            {t('common.continue')}
            <ArrowRight aria-hidden="true" />
          </Button>
        </form>

        {existing.length > 0 ? (
          <section className="mt-8 border-t pt-5">
            <h2 className="text-body-lg font-semibold">{t('onboarding.existingTitle')}</h2>
            <ul className="mt-3 space-y-2">
              {existing.map((membership) => (
                <li key={membership.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-xl border bg-subtle/50 px-3.5 py-3 text-left transition-colors duration-fast hover:border-primary/40 hover:bg-subtle"
                    onClick={() => {
                      setActiveOrg(membership.organization_id);
                      navigate(areaHome(areaFor(membership)));
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar
                        kind={membership.org_type === 'STORE' ? 'store' : 'company'}
                        size="md"
                        src={membership.logo_url}
                        className="rounded-xl"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-body font-semibold">{membership.org_name}</span>
                        <span className="text-label text-muted-foreground">{t(`roles.${membership.role}`)}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={membership.org_type === 'COMPANY' ? 'accent' : 'neutral'}>{t(`orgTypes.${membership.org_type}`)}</Badge>
                      <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </AuthPage>
    </AuthFrame>
  );
}
