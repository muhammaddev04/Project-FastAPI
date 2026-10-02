import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/montserrat/wght-italic.css';
// Phase E: display face of the public site. Declared as a dependency since CR-002 and never imported until now.
import '@fontsource-variable/noto-serif';
import './app/styles.css';
import './shared/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from './app/providers';
import { createAppRouter } from './app/router';
import { restoreSession } from './shared/auth/session-store';
import { initTheme } from './shared/theme/theme';

initTheme();
// Started before the first render, so guards see `restoring` instead of an apparent guest (SEC-004 + FE-008).
void restoreSession();
const router = createAppRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AppProviders>
  </StrictMode>,
);
