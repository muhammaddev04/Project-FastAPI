/**
 * The five screens between "I want a TezFarmo account" and "my organization is under review" (Phase D).
 *
 * Before this, registration was a single form that asked for the account, the role and the organization name at
 * once, and the three screens that followed it (confirm the email, create the organization, upload the
 * documents) were unrelated pages with no shared sense of position. The journey is the same work; naming its
 * steps in one list is what lets each screen ask for one thing and still say where the user is.
 *
 * The order is dictated by the backend, not by preference: `POST /auth/register` creates only the user, the
 * email must be confirmed before `POST /auth/login` will answer, and an organization can only be created by an
 * authenticated user, so the business questions cannot come earlier than they do here.
 *
 * The model lives apart from the components that draw it because both the guest layout and the onboarding
 * layout need it, and because a module that exports a component and a constant cannot be hot-reloaded.
 */
export const JOURNEY_STEPS = ['account', 'verify', 'type', 'setup', 'review'] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

export function journeyIndex(step: JourneyStep): number {
  return JOURNEY_STEPS.indexOf(step);
}

/** Guest routes that belong to a step; anything else is not part of the journey. */
const JOURNEY_BY_PATH: { prefix: string; step: JourneyStep }[] = [
  { prefix: '/register/verify', step: 'verify' },
  { prefix: '/verify-email', step: 'verify' },
  { prefix: '/register', step: 'account' },
];

export function journeyStepFor(pathname: string): JourneyStep | undefined {
  return JOURNEY_BY_PATH.find((entry) => pathname.startsWith(entry.prefix))?.step;
}

/** Vertical rhythm of an authentication form: one value per row, 20px apart. */
export const AUTH_FORM = 'space-y-5';
