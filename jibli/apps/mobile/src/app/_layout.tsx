import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { apiRequest, ApiError, NetworkError } from '@/lib/api';
import { clearSession, loadSession } from '@/lib/secure-session';
import { colors, enforceRtl } from '@/theme';

/**
 * App root.
 *
 * Two things happen before the first screen renders:
 *   1. RTL is forced — Release 1 is Arabic-only regardless of device locale
 *      (plan §2).
 *   2. The stored session is resolved, so a returning customer lands on Home
 *      and an incomplete profile is routed to the mandatory flow (plan §11).
 */

// RTL must be set before any layout happens, so this runs at module scope.
enforceRtl();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // A business error is an answer, not a failure — retrying it is noise.
        if (error instanceof ApiError) return false;
        // A flaky mobile connection deserves a couple of attempts.
        if (error instanceof NetworkError) return failureCount < 3;
        return failureCount < 1;
      },
    },
    mutations: { retry: false },
  },
});

type BootState = 'loading' | 'signed-out' | 'needs-profile' | 'ready';

interface MeResponse {
  user_id: string;
  profile_completed: boolean;
  modes: ('CUSTOMER' | 'DRIVER')[];
  driver_id: string | null;
}

export default function RootLayout() {
  const router = useRouter();
  const [boot, setBoot] = useState<BootState>('loading');

  useEffect(() => {
    let cancelled = false;

    const resolve = async (): Promise<void> => {
      const session = await loadSession();
      if (!session) {
        if (!cancelled) setBoot('signed-out');
        return;
      }

      try {
        const me = await apiRequest<MeResponse>('/api/v1/auth/me');
        if (cancelled) return;
        setBoot(me.profile_completed ? 'ready' : 'needs-profile');
      } catch (error) {
        if (cancelled) return;

        if (error instanceof NetworkError) {
          // Offline with a stored session: let the user in and work from cache.
          // Ordering still requires connectivity and revalidates server-side
          // (plan §109).
          setBoot('ready');
          return;
        }

        // The session is genuinely invalid.
        await clearSession();
        setBoot('signed-out');
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (boot === 'signed-out') router.replace('/(auth)/phone');
    else if (boot === 'needs-profile') router.replace('/(auth)/profile');
  }, [boot, router]);

  if (boot === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.orange500, justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.white} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            // Slide from the correct edge under RTL.
            animation: 'slide_from_left',
          }}
        >
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(driver)" options={{ animation: 'fade' }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
