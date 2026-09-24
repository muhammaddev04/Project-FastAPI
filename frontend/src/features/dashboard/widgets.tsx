import { ArrowRight, KeyRound, type LucideIcon, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { errorMessage } from '@/shared/api/errors';
import { useMembers } from '@/shared/auth/api';
import { areaFor } from '@/shared/auth/context';
import type { Membership } from '@/shared/auth/types';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton } from '@/shared/ui';

/** Role and permissions exactly as returned by /me. */
export function AccessCard({ membership }: { membership: Membership }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader title={t('dashboard.access.title')} description={t('dashboard.access.description')} />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-[0.8125rem] text-muted-foreground">{t('dashboard.access.role')}</span>
          <Badge tone="accent">{t(`roles.${membership.role}`)}</Badge>
        </div>
        {membership.permissions.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {membership.permissions.map((permission) => (
              <li key={permission}>
                <code className="rounded border bg-subtle px-1.5 py-0.5 text-2xs text-muted-foreground">{permission}</code>
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
        title={t('dashboard.team.title')}
        action={
          <Link to={`/${area}/team`} className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-accent hover:underline">
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
            <span className="flex size-9 items-center justify-center rounded-md bg-accent-soft text-accent">
              <Users className="size-4" aria-hidden="true" />
            </span>
            <p>
              <span className="text-xl font-semibold tabular-nums">{members.data.count}</span>{' '}
              <span className="text-[0.8125rem] text-muted-foreground">{t('dashboard.team.members')}</span>
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** A dashboard panel whose data arrives with a later TZ phase: honest empty state, no sample numbers. */
export function PendingPanel({ icon, title, description, phase }: { icon: LucideIcon; title: string; description: string; phase: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader title={title} action={<Badge tone="neutral">{t('planned.badge', { phase })}</Badge>} />
      <EmptyState icon={icon} title={t('dashboard.pending.title')} description={description} className="py-8" />
    </Card>
  );
}

/** Next steps for the organization, from the TZ onboarding checklist (§23), each tied to the phase delivering it. */
export function ReadinessChecklist({ membership, steps }: { membership: Membership; steps: { key: string; phase: string }[] }) {
  const { t } = useTranslation();
  const area = areaFor(membership);
  return (
    <Card>
      <CardHeader title={t('dashboard.readiness.title')} description={t('dashboard.readiness.description')} />
      <ol className="divide-y">
        {steps.map((step, index) => (
          <li key={step.key} className="flex items-start gap-3 px-5 py-3">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold text-muted-foreground">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-medium">{t(`dashboard.readiness.${area}.${step.key}.title`)}</p>
              <p className="text-[0.8125rem] text-muted-foreground">{t(`dashboard.readiness.${area}.${step.key}.text`)}</p>
            </div>
            <Badge tone="neutral">{t('planned.badge', { phase: step.phase })}</Badge>
          </li>
        ))}
      </ol>
    </Card>
  );
}
