import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation, useOutlet } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { AuthFrame } from './auth-frame';
import { AUTH_FORM, journeyStepFor } from './journey-steps';

/**
 * Authentication screens (Phase D).
 *
 * What this replaced: a centred, translucent card floating over a page-sized radial gradient with two slowly
 * drifting outlined circles and two blurred colour blobs, next to a desktop hero column holding a pill badge,
 * a three-line 60px display headline, two feature cards that lifted and glowed on hover, and a cluster of
 * three invented avatars ("TF", "B2B", a shop icon) above the line "companies and stores start trading once
 * their organization is verified". Signing in competed for attention with a landing page.
 *
 * What it is now: the shared two-plane `JourneyShell`. A navy aside carries the brand, one sentence about the
 * product and the position in the registration journey; the form sits on the plain canvas beside it with no
 * card around it. Removing the card is the change that makes the screen read as an application rather than a
 * promotion: a form that sits on the page does not need to be introduced.
 */
/** Layout route for every guest screen: the aside stays mounted while the working column cross-fades. */
export function AuthShell() {
  const location = useLocation();
  const outlet = useOutlet();
  return (
    <MotionConfig reducedMotion="user">
      <AuthFrame step={journeyStepFor(location.pathname)}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </AuthFrame>
    </MotionConfig>
  );
}

/**
 * One screen of the flow: where you are, what this asks for, and the form.
 *
 * The heading block is left-aligned. It used to be centred, in an arbitrary 1.625rem/2rem size, under a
 * "B2B PLATFORM" pill and above a `Trans`-interpolated gradient brand word. A centred heading over
 * left-aligned fields gives a form two competing axes, and the pill restated what the brand lockup two inches
 * away already says.
 *
 * Phase E moved the heading onto the public site's serif display step, which is what makes an authentication
 * screen read as part of the same website rather than as the door to a different one.
 */
export function AuthPage({
  title,
  lead,
  above,
  children,
  footer,
}: {
  title: ReactNode;
  lead?: ReactNode;
  /** Position line for a sequence that is not the onboarding journey (password recovery). */
  above?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div>
      {above ? <div className="mb-5">{above}</div> : null}
      {/* The same serif display face as the public site, so /login continues the page it came from. */}
      <h1 className="font-serif text-section-sm font-semibold leading-snug sm:text-section">{title}</h1>
      {lead ? <p className="mt-3 text-body leading-relaxed text-muted-foreground">{lead}</p> : null}
      <div className="mt-8">{children}</div>
      {footer ? <div className="mt-8 border-t pt-5 text-label text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

/** Closing line of a screen: a question and the one link that answers it. */
export function AuthSwitch({ question, to, link, state }: { question: string; to: string; link: string; state?: unknown }) {
  return (
    <p>
      {question}{' '}
      <Link to={to} state={state} className="link-grow font-semibold text-primary hover:text-primary-hover">
        {link}
      </Link>
    </p>
  );
}

/** An authentication form: `noValidate` (the messages are ours) and one value per row. */
export function AuthForm({ onSubmit, children }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode }) {
  return (
    <form noValidate className={AUTH_FORM} onSubmit={onSubmit}>
      {children}
    </form>
  );
}

/** Stacked actions under a form: the primary one first, then the quieter alternatives. */
export function AuthActions({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('space-y-2.5', className)}>{children}</div>;
}
