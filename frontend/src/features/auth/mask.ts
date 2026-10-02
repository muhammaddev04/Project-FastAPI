/**
 * Hides most of an email address while leaving it recognisable: "nigina@example.tj" becomes
 * "n\u2022\u2022\u2022\u2022a@example.tj".
 *
 * The verification and recovery screens have to name the inbox they sent a code to, or the user cannot tell a
 * typo from a slow mail server. Printing the whole address does that at the cost of showing it to anyone
 * looking at the screen, and these screens are often open on a phone in a shop. The domain stays: it is what
 * tells someone which of their mailboxes to open, and it is not the private half.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}\u2022${domain}`;
  const hidden = '\u2022'.repeat(Math.min(4, local.length - 2));
  return `${local[0]}${hidden}${local[local.length - 1]}${domain}`;
}
