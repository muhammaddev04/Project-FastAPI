import { z } from 'zod';

/** CR-001: email is the sign-in identifier. Trimmed and compared case-insensitively (the server lowercases too). */
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'validation.required')
  .max(254, 'validation.tooLong')
  .email('validation.email')
  .transform((value) => value.toLowerCase());

/** IAM-003 as enforced by backend app/modules/auth/password_policy.py (the common-password list is server-side). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export type PasswordRule = 'length' | 'letter' | 'digit';

export function passwordRules(password: string): Record<PasswordRule, boolean> {
  return {
    length: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
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
  .max(PASSWORD_MAX, 'validation.passwordTooLong')
  .refine((value) => passwordRules(value).letter && passwordRules(value).digit, 'validation.passwordLetterDigit');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'validation.required'),
});
export type LoginValues = z.input<typeof loginSchema>;

/**
 * Short registration: only what creating the account and starting the organization review needs
 * (role, organization name, owner name, email, password, terms). The rest of the profile is filled in later.
 * The interface language is sent as the preferred language; the password has a show/hide toggle instead of a repeat field.
 */
export const registerSchema = z.object({
  orgType: z.enum(['COMPANY', 'STORE']),
  orgName: z.string().trim().min(2, 'validation.nameTooShort').max(200, 'validation.tooLong'),
  fullName: z.string().trim().min(2, 'validation.nameTooShort').max(150, 'validation.tooLong'),
  email: emailSchema,
  password: newPasswordSchema,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'validation.acceptTerms' }) }),
});
export type RegisterValues = z.input<typeof registerSchema>;

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
