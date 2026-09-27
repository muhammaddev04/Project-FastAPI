/** CR-003 pre-check mirroring the server (JPEG/PNG/WebP, 5 MB). The server re-checks everything, magic bytes included. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Which picture this is: the user's avatar, a company logo or a store image (never mixed up in wording). */
export type ImageSubject = 'avatar' | 'companyLogo' | 'storeImage';
