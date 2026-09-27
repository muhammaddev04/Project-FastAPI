import { ArrowRight, KeyRound, ListChecks, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { errorMessage } from '@/shared/api/errors';
import { useMembers } from '@/shared/auth/api';
import { areaFor } from '@/shared/auth/context';
import type { Membership } from '@/shared/auth/types';
import { Badge, Card, CardBody, CardHeader, ErrorState, PhaseBadge, Skeleton } from '@/shared/ui';

/** Role and permissions exactly as returned by /me. */
export function AccessCard({ membership }: { membership: Membership }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader icon={<KeyRound />} title={t('dashboard.access.title')} description={t('dashboard.access.description')} />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[0.8125rem] text-muted-foreground">{t('dashboard.access.role')}</span>
          <Badge tone="accent">{t(`roles.${membership.role}`)}</Badge>
        </div>
        {membership.permissions.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {membership.permissions.map((permission) => (
              <li key={permission}>
                <code className="rounded-lg border bg-subtle/70 px-2 py-0.5 font-data text-2xs text-muted-foreground">{permission}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">{t('dashboard.access.none')}</p>
        )}
      </CardBody>
    </Card>
  );
}

/** Live team size from GET /members (only for roles with members.view). */
export function TeamCard({ membership }: { membership: Membership }) {
  const { t } = useTranslation();
  const canView = membership.permissions.includes('members.view');
  const members = useMembers(canView ? membership.organization_id : null, { limit: 1 });
  if (!canView) return null;
  const area = areaFor(membership);
  return (
    <Card>
      <CardHeader
        icon={<Users />}
        title={t('dashboard.team.title')}
        action={
          <Link to={`/${area}/team`} className="link-grow inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-primary hover:text-primary-hover">
            {t('dashboard.team.open')} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        }
      />
      <CardBody>
        {members.isPending ? (
          <Skeleton className="h-8 w-24" />
        ) : members.isError ? (
          <ErrorState message={errorMessage(members.error, t)} onRetry={() => void members.refetch()} className="py-4" />
        ) : (
          <div className="flex items-center gap-3">
            <p>
              <span className="font-display text-3xl font-extrabold tabular-nums text-foreground">{members.data.count}</span>{' '}
              <span className="text-[0.8125rem] text-muted-foreground">{t('dashboard.team.members')}</span>
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Next steps for the organization, from the TZ onboarding checklist (§23), each tied to the phase delivering it. */
export function ReadinessChecklist({ membership, steps }: { membership: Membership; steps: { key: string; phase: string }[] }) {
  const { t } = useTranslation();
  const area = areaFor(membership);
  return (
    <Card>
      <CardHeader icon={<ListChecks />} title={t('dashboard.readiness.title')} description={t('dashboard.readiness.description')} />
      <ol className="divide-y">
        {steps.map((step, index) => (
          <li key={step.key} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-subtle/40">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-2xs font-bold text-primary">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.875rem] font-semibold">{t(`dashboard.readiness.${area}.${step.key}.title`)}</p>
              <p className="text-[0.8125rem] text-muted-foreground">{t(`dashboard.readiness.${area}.${step.key}.text`)}</p>
            </div>
            <PhaseBadge phase={step.phase} />
          </li>
        ))}
      </ol>
    </Card>
  );
}
