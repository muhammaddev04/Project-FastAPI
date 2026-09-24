import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources, type SupportedLanguage } from './resources';

const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('tezfarmo.language') as SupportedLanguage | null : null;
const browser = typeof navigator !== 'undefined' && navigator.language.startsWith('ru') ? 'ru' : 'tg';

void i18n.use(initReactI18next).init({ resources, lng: saved ?? browser, fallbackLng: 'tg', interpolation: { escapeValue: false } });

export function changeLanguage(language: SupportedLanguage) {
  localStorage.setItem('tezfarmo.language', language);
  void i18n.changeLanguage(language);
}

export { i18n };
