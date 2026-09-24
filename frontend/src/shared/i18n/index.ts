import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ru from './ru.json';
import tg from './tg.json';

export const SUPPORTED_LANGUAGES = ['tg', 'ru', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'tg';
const STORAGE_KEY = 'tezfarmo.language';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

function readStoredLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Stored choice, else browser language when supported, else tg (01_GLOBAL §12). */
export function detectLanguage(): Language {
  const stored = readStoredLanguage();
  if (stored) return stored;
  const browser = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2).toLowerCase() : '';
  return isLanguage(browser) ? browser : DEFAULT_LANGUAGE;
}

void i18n.use(initReactI18next).init({
  resources: { tg: { translation: tg }, ru: { translation: ru }, en: { translation: en } },
  lng: detectLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on('languageChanged', (language) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
});
if (typeof document !== 'undefined') document.documentElement.lang = i18n.language;

export function setLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* storage may be unavailable (private mode); the in-memory choice still applies */
  }
  void i18n.changeLanguage(language);
}

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}

export { i18n };
