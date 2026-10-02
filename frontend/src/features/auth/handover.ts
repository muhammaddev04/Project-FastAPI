/**
 * What one authentication screen tells the next one.
 *
 * All of it travels in router state, which lives in the history entry and never in storage: the address is
 * convenience, not proof, and the screen that receives it still asks the backend to verify everything. The
 * types live apart from the pages because /login and step 2 hand over to each other in both directions.
 */

/** Step 1 to step 2, and /login to step 2 when an unconfirmed address tried to sign in. */
export type VerifyEmailState = { email?: string; justRegistered?: boolean } | null;

/** Step 2 to /login: the confirmed address, so only the password is left to type. */
export type LoginState = { email?: string; justVerified?: boolean } | null;

/** Step 2 of the journey. `/verify-email` renders the same page so older links keep working. */
export const VERIFY_PATH = '/register/verify';
