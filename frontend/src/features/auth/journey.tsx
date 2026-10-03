import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { JOURNEY_STEPS, journeyIndex, type JourneyStep } from './journey-steps';

type State = 'done' | 'current' | 'upcoming';

function stateOf(index: number, currentIndex: number): State {
  return index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
}

/**
 * The journey rail for the editorial column (Phase E, rebuilt).
 *
 * Phase D drew dots joined by a connector, with a hint under the current step. That is a widget, and it made the
 * rail the loudest thing in the column. This is an indexed list instead: a monospaced numeral, the step name,
 * and a rule. The current step is the only one in full ink with the teal numeral; completed steps are quiet;
 * upcoming ones are quieter still. No circles, no connector, no fill.
 *
 * State is carried by the numeral colour, the text weight AND a word in the accessible name, so it survives
 * both a greyscale rendering and a reader who cannot separate teal from grey.
 */
export function JourneyRail({ current }: { current: JourneyStep }) {
  const { t } = useTranslation();
  const currentIndex = journeyIndex(current);
  return (
    <ol aria-label={t('auth.journey.label')} className="border-t">
      {JOURNEY_STEPS.map((step, index) => {
        const state = stateOf(index, currentIndex);
        return (
          <li key={step} aria-current={state === 'current' ? 'step' : undefined} className="flex items-baseline gap-4 border-b py-3.5">
            <span
              aria-hidden="true"
              className={cn('font-data text-caption tabular-nums', state === 'current' ? 'text-primary' : 'text-muted-foreground/70')}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span
              className={cn(
                'min-w-0 text-body',
                state === 'current' ? 'font-semibold text-foreground' : state === 'done' ? 'text-foreground/70' : 'text-muted-foreground',
              )}
            >
              {t(`auth.journey.steps.${step}.title`)}
            </span>
            <span className="sr-only">{t(`auth.journey.state.${state}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The same position for viewports with no editorial column: the count, the step name, and one hairline rule
 * filled to the fraction reached. A five-segment bar was a widget standing in for one sentence.
 */
export function JourneyProgress({ current, className }: { current: JourneyStep; className?: string }) {
  const { t } = useTranslation();
  const currentIndex = journeyIndex(current);
  const total = JOURNEY_STEPS.length;
  return (
    <div className={cn('lg:hidden', className)}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-data text-caption tabular-nums text-primary">
          {t('auth.journey.position', { current: currentIndex + 1, total })}
        </span>
        <span className="text-caption text-muted-foreground">{t(`auth.journey.steps.${current}.title`)}</span>
      </p>
      <div className="mt-3 h-px w-full bg-border" role="presentation">
        <div className="h-px bg-primary" style={{ width: `${((currentIndex + 1) / total) * 100}%` }} />
      </div>
    </div>
  );
}

/** Position inside a short sequence that is not the onboarding journey (password recovery). */
export function StepCount({ current, total, label }: { current: number; total: number; label: string }) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-data text-caption tabular-nums text-primary">{t('auth.journey.position', { current, total })}</span>
      <span className="text-caption text-muted-foreground">{label}</span>
    </p>
  );
}
