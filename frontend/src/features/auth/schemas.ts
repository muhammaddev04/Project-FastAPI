import { z } from 'zod';

/** CR-001: email is the sign-in identifier. Trimmed and compared case-insensitively (the server lowercases too). */
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'validation.required')
  .max(254, 'validation.tooLong')
  .email('validation.email')
  .transform((value) => value.toLowerCase());

/** Acceptance limits match the backend; strength recommendations are advisory. */
export const PASSWORD_MIN = 4;
export const PASSWORD_RECOMMENDED_MIN = 8;
export const PASSWORD_MAX = 128;

export type PasswordRule = 'length' | 'letter' | 'digit';

export function passwordRules(password: string): Record<PasswordRule, boolean> {
  return {
    length: password.length >= PASSWORD_RECOMMENDED_MIN && password.length <= PASSWORD_MAX,
    letter: /\p{L}/u.test(password),
    digit: /\d/.test(password),
  };
}

/** IAM-003 `weak_password` detail codes (backend password_policy.py) → our `validation.*` messages. */
export const PASSWORD_PROBLEMS: Record<string, string> = {
  password_too_short: 'validation.passwordTooShort',
  password_too_long: 'validation.passwordTooLong',
  password_needs_letter_and_digit: 'validation.passwordLetterDigit',
  password_too_common: 'validation.passwordTooCommon',
};

/** The same rule for registration, password reset and password change. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, 'validation.passwordTooShort')
  .max(PASSWORD_MAX, 'validation.passwordTooLong');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'validation.required'),
});
export type LoginValues = z.input<typeof loginSchema>;

/**
 * Step 1 of the journey: exactly the four values `POST /auth/register` needs to create a user, plus the terms.
 *
 * `org_type` and `org_name` used to be collected here as the P01 §10 onboarding intent. They are optional on
 * RegisterRequest, and asking a stranger to classify their business before they have an account put the
 * hardest question on the first screen; the Company/Store choice is now step 3, where the answer immediately
 * creates the organization instead of being parked on the user record. The interface language is sent as the
 * preferred language, and the password has a show/hide toggle rather than a repeat field.
 */
export const createAccountSchema = z.object({
  fullName: z.string().trim().min(2, 'validation.nameTooShort').max(150, 'validation.tooLong'),
  email: emailSchema,
  password: newPasswordSchema,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'validation.acceptTerms' }) }),
});
export type CreateAccountValues = z.input<typeof createAccountSchema>;

/** The 6-digit email verification code (backend: exactly six ASCII digits). */
export const verificationCodeSchema = z.string().regex(/^[0-9]{6}$/, 'validation.codeSixDigits');

export const verifyEmailSchema = z.object({ email: emailSchema, code: verificationCodeSchema });
export type VerifyEmailValues = z.input<typeof verifyEmailSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetCodeSchema = z.object({ code: verificationCodeSchema });
export type ResetCodeValues = z.input<typeof resetCodeSchema>;
export type ForgotPasswordValues = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({ password: newPasswordSchema, confirmPassword: z.string() })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'validation.passwordsMismatch',
  });
export type ResetPasswordValues = z.input<typeof resetPasswordSchema>;
