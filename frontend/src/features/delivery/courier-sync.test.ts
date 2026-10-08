import { syncQueue } from './courier-sync';
import { operations, remove, save, wire, type QueuedOperation } from './offline-queue';
import { apiRequest } from '@/shared/api/client';

vi.mock('./offline-queue', () => ({ operations: vi.fn(), remove: vi.fn(), save: vi.fn(), wire: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiRequest: vi.fn() }));
const row: QueuedOperation = {
  scope: 'user:company',
  operation_id: 'operation-1',
  operation_type: 'DELIVERY_ARRIVE',
  entity_id: 'delivery-1',
  payload: {},
  expected_status: 'IN_TRANSIT',
  client_created_at: '2026-10-06T08:00:00Z',
  retry_count: 0,
  status: 'PENDING',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(operations).mockResolvedValue([{ ...row }]);
  vi.mocked(wire).mockResolvedValue({
    operation_id: row.operation_id,
    operation_type: row.operation_type,
    entity_id: row.entity_id,
    payload: {},
    expected_status: row.expected_status,
    client_created_at: row.client_created_at,
  });
});

it('removes applied operations after acknowledgement', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ results: [{ operation_id: row.operation_id, result_status: 'APPLIED' }] });
  await syncQueue(row.scope, 'company');
  expect(remove).toHaveBeenCalledWith(row.operation_id);
  expect(operations).toHaveBeenCalledWith(row.scope);
});

it('moves a conflict out of the pending queue with authoritative server status', async () => {
  vi.mocked(apiRequest).mockResolvedValue({
    results: [{ operation_id: row.operation_id, result_status: 'CONFLICT', error: 'sync_conflict', server_state: { status: 'FAILED' } }],
  });
  await syncQueue(row.scope, 'company');
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: 'CONFLICT', server_status: 'FAILED', sealed_code: undefined }));
  expect(remove).not.toHaveBeenCalled();
});

it('retains an unacknowledged operation with bounded retry backoff', async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error('network'));
  await expect(syncQueue(row.scope, 'company')).rejects.toThrow('network');
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING', retry_count: 1, next_retry_at: expect.any(Number) }));
  expect(remove).not.toHaveBeenCalled();
});

it('reports an expired encryption key without sending a damaged confirmation', async () => {
  vi.mocked(wire).mockResolvedValue(null);
  await syncQueue(row.scope, 'company');
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: 'REJECTED', error: 'delivery_session_expired' }));
  expect(apiRequest).not.toHaveBeenCalled();
});

it('leaves the queue alone while offline', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await syncQueue(row.scope, 'company');
  expect(apiRequest).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
