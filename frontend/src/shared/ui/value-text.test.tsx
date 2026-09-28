import { render, screen } from '@testing-library/react';
import { DateText, MoneyText, QuantityText } from './value-text';

const text = (element: HTMLElement) => element.textContent?.replaceAll(' ', ' ');

describe('FND-035 MoneyText / QuantityText / DateText', () => {
  it('MoneyText renders the GLOBAL §12 format', () => {
    render(<MoneyText value="1250.00" />);
    expect(text(screen.getByText(/TJS/))).toBe('1 250,00 TJS');
  });

  it('QuantityText renders without trailing zeros and without a unit', () => {
    render(<QuantityText value="12.500" />);
    expect(text(screen.getByText('12,5'))).toBe('12,5');
  });

  it('shows a dash when there is no value', () => {
    const { container } = render(
      <>
        <MoneyText value={null} />
        <QuantityText value={undefined} />
        <DateText value={null} />
      </>,
    );
    expect(container.textContent).toBe('———');
  });

  it('DateText renders a machine-readable <time> in Dushanbe time', () => {
    render(<DateText value="2026-09-28T09:05:00Z" />);
    const time = screen.getByText('28.09.2026 14:05');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-09-28T09:05:00Z');
  });

  it('DateText dateOnly renders dd.MM.yyyy', () => {
    render(<DateText value="2026-09-28T20:00:00Z" dateOnly />);
    expect(screen.getByText('29.09.2026')).toBeInTheDocument();
  });
});
