import { screen, within } from '@testing-library/react';
import { JOURNEY_STEPS, journeyIndex, journeyStepFor } from './journey-steps';
import { JourneyProgress, JourneyRail } from './journey';
import { maskEmail } from './mask';
import { renderWithProviders } from '@/test/render';

describe('registration journey', () => {
  it('runs in the order the backend allows', () => {
    expect([...JOURNEY_STEPS]).toEqual(['account', 'verify', 'type', 'setup', 'review']);
    expect(journeyIndex('type')).toBe(2);
  });

  it.each([
    ['/register', 'account'],
    ['/register/verify', 'verify'],
    ['/verify-email', 'verify'],
    ['/login', undefined],
    ['/forgot-password', undefined],
    ['/auth/google/callback', undefined],
  ])('maps %s to %s', (path, step) => {
    expect(journeyStepFor(path)).toBe(step);
  });

  it('marks done, current and upcoming steps for assistive technology, not by colour alone', () => {
    renderWithProviders(<JourneyRail current="type" />);
    const items = within(screen.getByRole('list', { name: 'Setting up your account' })).getAllByRole('listitem');

    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('done');
    expect(items[1]).toHaveTextContent('done');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[2]).toHaveTextContent('current step');
    expect(items[2]).toHaveTextContent('Business type');
    // Phase E: the rail is an index, not a widget. The step's own explanation belongs to the step's page, so the
    // rail carries the name and the state and nothing else.
    expect(items[2]).not.toHaveTextContent('Are you a supplier or a store?');
    expect(items[3]).toHaveTextContent('not started');
    expect(items[3]).not.toHaveAttribute('aria-current');
  });

  it('states the position in words on viewports without the aside', () => {
    renderWithProviders(<JourneyProgress current="setup" />);
    expect(screen.getByText('Step 4 of 5')).toBeInTheDocument();
    expect(screen.getByText('Business details')).toBeInTheDocument();
  });
});

describe('maskEmail', () => {
  it.each([
    ['nigina@example.tj', 'n••••a@example.tj'],
    ['ab@example.tj', 'a•@example.tj'],
    ['a@example.tj', 'a•@example.tj'],
    ['dilshod.rahimov@pamir.co.tj', 'd••••v@pamir.co.tj'],
    // A plus-addressed mailbox is masked like any other; the domain is what identifies the inbox.
    ['shop+orders@example.tj', 's••••s@example.tj'],
  ])('masks %s as %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });

  it('never reveals the local part it was given', () => {
    expect(maskEmail('nigina@example.tj')).not.toContain('nigina');
  });

  it('leaves something that is not an address alone', () => {
    expect(maskEmail('not-an-address')).toBe('not-an-address');
    expect(maskEmail('@example.tj')).toBe('@example.tj');
  });
});
