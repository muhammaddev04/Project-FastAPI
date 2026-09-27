import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// findBy*/waitFor default to 1 s; on a loaded machine running the whole suite in parallel that is too tight.
configure({ asyncUtilTimeout: 10000 });
