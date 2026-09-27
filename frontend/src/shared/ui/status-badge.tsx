import { useTranslation } from 'react-i18next';
import { Badge } from './badge';
import { PRESETS, statusTone, type Preset, type StatusKind } from './status-tones';

export function StatusBadge({ kind, value, className }: { kind: StatusKind; value: string; className?: string }) {
  const { t } = useTranslation();
  const preset: Preset = PRESETS[kind];
  const Icon = preset.icons?.[value];
  return (
    <Badge tone={statusTone(kind, value)} className={className}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {t(`${preset.label}.${value}`)}
    </Badge>
  );
}
