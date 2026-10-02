import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { JOURNEY_STEPS, journeyIndex, type JourneyStep } from './journey-steps';

type State = 'done' | 'current' | 'upcoming';

function stateOf(index: number, currentIndex: number): State {
  return index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
}

/**
 * Vertical journey list for the navy aside (lg and up).
 *
 * A dot and a hairline connector, not numbered circles: the number is already in the "Step 2 of 5" line that
 * the same component renders on phones, and printing it twice made the rail the loudest thing on the screen.
 * State is carried by the mark (check / filled dot / hollow dot), the weight and the colour together, so it
 * survives both a greyscale rendering and a user who cannot separate teal from grey.
 */
export function JourneyRail({ current }: { current: JourneyStep }) {
  const { t } = useTranslation();
  const currentIndex = journeyIndex(current);
  return (
    <ol aria-label={t('auth.journey.label')} className="space-y-0">
      {JOURNEY_STEPS.map((step, index) => {
        const state = stateOf(index, currentIndex);
        const last = index === JOURNEY_STEPS.length - 1;
        return (
          <li key={step} aria-current={state === 'current' ? 'step' : undefined} className="flex gap-3.5">
            <span className="flex flex-col items-center pt-1" aria-hidden="true">
              <span
                className={cn(
                  'flex size-[1.125rem] shrink-0 items-center justify-center rounded-full border transition-colors',
                  state === 'done'
                    ? 'border-aside-accent bg-aside-accent text-aside'
                    : state === 'current'
                      ? 'border-aside-accent bg-aside-accent/20'
                      : 'border-aside-border',
                )}
              >
                {state === 'done' ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : state === 'current' ? (
                  <span className="size-1.5 rounded-full bg-aside-accent" />
                ) : null}
              </span>
              {last ? null : <span className={cn('w-px flex-1', index < currentIndex ? 'bg-aside-accent/50' : 'bg-aside-border')} />}
            </span>
            <span className={cn('min-w-0 pb-5', last && 'pb-0')}>
              <span
                className={cn(
                  'block text-body-lg leading-snug',
                  state === 'current' ? 'font-semibold text-aside-foreground' : state === 'done' ? 'text-aside-foreground/80' : 'text-aside-muted',
                )}
              >
                {t(`auth.journey.steps.${step}.title`)}
              </span>
              {state === 'current' ? (
                <span className="mt-1 block text-label leading-snug text-aside-muted">{t(`auth.journey.steps.${step}.hint`)}</span>
              ) : null}
              <span className="sr-only">{t(`auth.journey.state.${state}`)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The same position, compactly, for every viewport that has no aside: the count, the step name and a bar of
 * one segment per step. It replaces the per-page "After registration: 1 confirm email, 2 review, 3 access"
 * strip, which described the journey without ever saying which part of it the user was looking at.
 */
export function JourneyProgress({ current, className }: { current: JourneyStep; className?: string }) {
  const { t } = useTranslation();
  const currentIndex = journeyIndex(current);
  return (
    <div className={cn('lg:hidden', className)}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-caption font-semibold uppercase tracking-[0.08em] text-primary-ink">
          {t('auth.journey.position', { current: currentIndex + 1, total: JOURNEY_STEPS.length })}
        </span>
        <span className="text-caption text-muted-foreground">{t(`auth.journey.steps.${current}.title`)}</span>
      </p>
      <ol aria-label={t('auth.journey.label')} className="mt-2 flex gap-1.5">
        {JOURNEY_STEPS.map((step, index) => {
          const state = stateOf(index, currentIndex);
          return (
            <li
              key={step}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn('h-1 flex-1 rounded-full', state === 'upcoming' ? 'bg-muted' : 'bg-primary')}
            >
              <span className="sr-only">{`${t(`auth.journey.steps.${step}.title`)} ${t(`auth.journey.state.${state}`)}`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Position inside a short self-contained sequence that is not the onboarding journey (password recovery).
 * Same restraint, no rail: three steps do not need a map, only a count.
 */
export function StepCount({ current, total, label }: { current: number; total: number; label: string }) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-caption font-semibold uppercase tracking-[0.08em] text-primary-ink">
        {t('auth.journey.position', { current, total })}
      </span>
      <span className="text-caption text-muted-foreground">{label}</span>
    </p>
  );
}
