import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { enqueue, operations, remove, save, wire, type OperationType, type QueuedOperation } from './offline-queue';
import type { SyncResult } from './api';

const running = new Map<string, Promise<void>>();

export function syncQueue(scope: string, orgId: string): Promise<void> {
  const existing = running.get(scope);
  if (existing) return existing;
  const task = (async () => {
    if (!navigator.onLine) return;
    const pending = (await operations(scope))
      .filter((row) => row.status === 'PENDING' && (row.next_retry_at ?? 0) <= Date.now())
      .slice(0, 100);
    const batch = [];
    for (const row of pending) {
      const operation = await wire(row);
      if (operation) batch.push(operation);
      else await save({ ...row, status: 'REJECTED', sealed_code: undefined, error: 'delivery_session_expired' });
    }
    if (!batch.length) return;
    try {
      const answer = await apiRequest<{ results: SyncResult[] }>('/courier/sync', {
        method: 'POST',
        headers: { 'X-Org-Id': orgId },
        body: { operations: batch },
      });
      for (const result of answer.results) {
        const row = pending.find((item) => item.operation_id === result.operation_id);
        if (!row) continue;
        if (result.result_status === 'APPLIED' || result.result_status === 'DUPLICATE') await remove(row.operation_id);
        else
          await save({
            ...row,
            status: result.result_status,
            sealed_code: undefined,
            error: result.error ?? undefined,
            server_status: result.server_state?.status,
          });
      }
    } catch (error) {
      for (const row of pending) {
        if (!(await operations(scope)).some((item) => item.operation_id === row.operation_id && item.status === 'PENDING')) continue;
        await save({
          ...row,
          retry_count: row.retry_count + 1,
          next_retry_at: Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(row.retry_count, 8)),
        });
      }
      throw error;
    }
  })().finally(() => running.delete(scope));
  running.set(scope, task);
  return task;
}

export function useCourierSync(userId: string, orgId: string) {
  const scope = `${userId}:${orgId}`;
  const cache = useQueryClient();
  const [rows, setRows] = useState<QueuedOperation[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState<unknown>();
  const refresh = useCallback(async () => setRows(await operations(scope)), [scope]);
  const sync = useCallback(async () => {
    try {
      await syncQueue(scope, orgId);
      setError(undefined);
      if (navigator.onLine) await cache.invalidateQueries({ queryKey: ['catalog', orgId] });
    } catch (reason) {
      setError(reason);
    }
    await refresh();
  }, [scope, orgId, cache, refresh]);
  useEffect(() => {
    void sync();
    const connected = () => {
      setOnline(navigator.onLine);
      void sync();
    };
    window.addEventListener('online', connected);
    window.addEventListener('offline', connected);
    const interval = window.setInterval(() => void sync(), 30_000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', connected);
    };
  }, [sync]);
  const act = async (type: OperationType, entity: string, expected: string, payload?: Record<string, unknown>) => {
    await enqueue(scope, type, entity, expected, payload);
    await refresh();
    await sync();
  };
  return { rows, online, error, sync, act, scope };
}
