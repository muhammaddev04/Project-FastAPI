import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setLanguage } from '@/shared/i18n';
import { Button, ErrorState, FormField, Input, PasswordInput } from './index';

describe('UI kit (FND-035)', () => {
  beforeEach(() => setLanguage('en'));

  it('FormField links label, control and error for assistive technology', () => {
    render(
      <FormField label="Phone" error="Enter a valid phone">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText('Phone');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid phone');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid phone');
  });

  it('FormField shows a hint when there is no error', () => {
    render(
      <FormField label="Email" hint="We never share it">
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('We never share it');
  });

  it('Button in loading state is busy and disabled', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('PasswordInput toggles visibility with an accessible control', async () => {
    render(
      <FormField label="Password">
        <PasswordInput />
      </FormField>,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ErrorState offers a retry action (FE-001)', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
