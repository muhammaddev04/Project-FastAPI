import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import type { components } from '@/shared/api/schema';
import { useMe } from '@/shared/auth/api';
import { useSessionStore } from '@/shared/auth/session-store';

export type Notification = components['schemas']['NotificationOut'];
export type NotificationPage = components['schemas']['Page_NotificationOut_'];
export type Preference = components['schemas']['PreferenceOut'];
type PreferenceIn = components['schemas']['PreferenceIn'];
type TelegramLink = components['schemas']['TelegramLinkOut'];
type TelegramToken = components['schemas']['TelegramTokenOut'];

function useIdentity() {
  const token = useSessionStore((state) => state.accessToken);
  const me = useMe();
  return { id: me.data?.id, enabled: Boolean(token && me.data?.id) };
}

export function useNotifications(unread = false, offset = 0, limit = 20, open = true) {
  const { id, enabled } = useIdentity();
  return useQuery({
    queryKey: ['notifications', id, 'list', unread, offset, limit],
    queryFn: () => apiRequest<NotificationPage>(`/notifications?unread=${unread}&offset=${offset}&limit=${limit}`),
    enabled: enabled && open,
    refetchInterval: 30_000,
  });
}

export function useUnreadCount() {
  const { id, enabled } = useIdentity();
  return useQuery({
    queryKey: ['notifications', id, 'unread'],
    queryFn: () => apiRequest<{ count: number }>('/notifications/unread-count'),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useReadNotification() {
  const { id } = useIdentity();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string | null) =>
      apiRequest(notificationId ? `/notifications/${notificationId}/read` : '/notifications/read-all', { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications', id] }),
  });
}

export function usePreferences() {
  const { id, enabled } = useIdentity();
  return useQuery({
    queryKey: ['notifications', id, 'preferences'],
    queryFn: () => apiRequest<Preference[]>('/notifications/preferences'),
    enabled,
  });
}

export function useSavePreference() {
  const { id } = useIdentity();
  const client = useQueryClient();
  const key = ['notifications', id, 'preferences'];
  return useMutation({
    mutationFn: (preference: PreferenceIn) => apiRequest<Preference[]>('/notifications/preferences', { method: 'PUT', body: [preference] }),
    onMutate: async (preference) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Preference[]>(key);
      client.setQueryData<Preference[]>(
        key,
        previous?.map((row) =>
          row.event_group === preference.event_group && row.channel === preference.channel ? { ...row, enabled: preference.enabled } : row,
        ),
      );
      return { previous };
    },
    onError: (_error, _preference, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
    },
    onSuccess: (data) => client.setQueryData(key, data),
  });
}

export function useTelegramLink(polling = false) {
  const { id, enabled } = useIdentity();
  return useQuery({
    queryKey: ['telegram', id, 'link'],
    queryFn: () => apiRequest<TelegramLink>('/telegram/link'),
    enabled,
    refetchInterval: polling ? 3000 : false,
  });
}

export function useTelegramToken() {
  return useMutation({ mutationFn: () => apiRequest<TelegramToken>('/telegram/link-token', { method: 'POST' }), gcTime: 0 });
}

export function useUnlinkTelegram() {
  const { id } = useIdentity();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest('/telegram/link', { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['telegram', id] }),
  });
}
