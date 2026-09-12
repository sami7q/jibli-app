'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '@/hooks/use-session';
import { useState } from 'react';
import { ApiError } from '@/lib/api';

/**
 * Client providers.
 *
 * Retry policy matters here: plan §113 says a business condition such as
 * ORDER_ALREADY_UPDATED must refresh the view, not be retried blindly, and an
 * authorization failure must re-authenticate rather than hammer the API.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Live operations need fresh data; analytics tolerate more.
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              if (error instanceof ApiError) {
                // 4xx means the request was wrong, not that the network failed.
                if (error.status < 500) return false;
              }
              return failureCount < 2;
            },
          },
          mutations: {
            // A command that moves state is never retried automatically: the
            // server decides idempotency, not the client (plan §28).
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* One refresh loop per tab. See SessionProvider for why that is a
          correctness requirement and not a tidiness one. */}
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
