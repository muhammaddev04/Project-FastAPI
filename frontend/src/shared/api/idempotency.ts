/** Keep a key for an unchanged submission until its result is known to have succeeded. */
export function createSubmissionKey() {
  let pending: { signature: string; key: string } | undefined;
  return {
    forPayload(payload: unknown): string {
      const signature = JSON.stringify(payload);
      if (!pending || pending.signature !== signature) pending = { signature, key: crypto.randomUUID() };
      return pending.key;
    },
    complete() { pending = undefined; },
  };
}
