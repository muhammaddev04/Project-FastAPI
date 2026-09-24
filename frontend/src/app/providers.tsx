import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from './query-client';

export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </QueryClientProvider>
  );
}
