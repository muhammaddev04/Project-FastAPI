import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/shared/ui/segmented-control';
import { SUPPORTED_LANGUAGES, currentLanguage, setLanguage, type Language } from './index';

/** FND-033: TG / RU / EN switch; the choice is stored in localStorage. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <SegmentedControl<Language>
      className={className}
      label={t('common.language')}
      value={currentLanguage()}
      onChange={setLanguage}
      options={SUPPORTED_LANGUAGES.map((language) => ({
        value: language,
        label: language.toUpperCase(),
        title: t(`languages.${language}`),
      }))}
    />
  );
}
