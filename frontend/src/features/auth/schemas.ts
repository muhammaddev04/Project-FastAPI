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

export const registerSchema = z
  .object({
    orgType: z.enum(['COMPANY', 'STORE']),
    orgName: z.string().trim().min(2, 'validation.nameTooShort').max(200, 'validation.tooLong'),
    fullName: z.string().trim().min(2, 'validation.nameTooShort').max(150, 'validation.tooLong'),
    email: emailSchema,
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'validation.acceptTerms' }) }),
    language: z.enum(['tg', 'ru', 'en']),
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'validation.passwordsMismatch',
  });
export type RegisterValues = z.input<typeof registerSchema>;

/** Three steps: account (email + password), organization, final confirmation. */
export const REGISTER_STEPS: { id: 'account' | 'organization' | 'confirm'; fields: (keyof RegisterValues)[] }[] = [
  { id: 'account', fields: ['orgType', 'fullName', 'email', 'password', 'confirmPassword', 'acceptTerms'] },
  { id: 'organization', fields: ['orgName', 'language'] },
  { id: 'confirm', fields: [] },
];

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordValues = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({ password: newPasswordSchema, confirmPassword: z.string() })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'validation.passwordsMismatch',
  });
export type ResetPasswordValues = z.input<typeof resetPasswordSchema>;
