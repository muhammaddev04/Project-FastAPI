import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GoogleCallbackPage } from './pages/GoogleCallbackPage';

describe('Google callback', () => {
  it('shows a safe cancellation state without a code', () => {
    render(<MemoryRouter initialEntries={['/auth/google/callback?error=access_denied']}><GoogleCallbackPage /></MemoryRouter>);
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /return to sign in/i })).toBeInTheDocument();
  });
});
