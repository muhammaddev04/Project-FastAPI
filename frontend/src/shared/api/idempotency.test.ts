import { createSubmissionKey } from './idempotency';

describe('submission idempotency keys', () => {
  it('keeps a key for retries and rotates after success or a changed payload', () => {
    const submission = createSubmissionKey();
    const first = submission.forPayload({ orgId: 'a', documents: [1] });
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(submission.forPayload({ orgId: 'a', documents: [1] })).toBe(first);
    const changed = submission.forPayload({ orgId: 'a', documents: [2] });
    expect(changed).not.toBe(first);
    expect(submission.forPayload({ orgId: 'b', documents: [2] })).not.toBe(changed);
    const beforeSuccess = submission.forPayload({ orgId: 'b', documents: [2] });
    submission.complete();
    expect(submission.forPayload({ orgId: 'b', documents: [2] })).not.toBe(beforeSuccess);
  });
});
