import { fireEvent, render, screen } from '@testing-library/react';
import { Avatar } from './avatar';

const URL_A = 'https://storage.test/a.webp?X-Amz-Expires=300&X-Amz-Signature=a';

describe('Avatar with a CR-003 picture', () => {
  it('shows the picture with its accessible name', () => {
    render(<Avatar name="Dilshod Rahimov" src={URL_A} alt="Profile photo of Dilshod Rahimov" />);
    expect(screen.getByRole('img', { name: 'Profile photo of Dilshod Rahimov' })).toHaveAttribute('src', URL_A);
  });

  it('is decorative without alt text (the name is shown next to it)', () => {
    const { container } = render(<Avatar kind="store" src={URL_A} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('falls back to the initials when the picture cannot load (e.g. an expired signed URL)', () => {
    const { container, rerender } = render(<Avatar name="Dilshod Rahimov" src={URL_A} alt="Photo" />);
    fireEvent.error(screen.getByRole('img', { name: 'Photo' }));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('DR')).toBeInTheDocument();
    // A new URL (after the next /me) is tried again.
    rerender(<Avatar name="Dilshod Rahimov" src={`${URL_A}&v=2`} alt="Photo" />);
    expect(screen.getByRole('img', { name: 'Photo' })).toBeInTheDocument();
  });

  it('shows the kind mark when there is no picture', () => {
    const { container } = render(<Avatar kind="company" src={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
