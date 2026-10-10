import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The two diagrams P12 §5 asks for, drawn as inline SVG against the design tokens: a line for a figure over
 * time and bars for the aging buckets. Both are single-series, so no legend is needed - the card title names
 * the measure - and the same rows are always listed in the table below, which is the accessible view of the
 * data (a screen reader is sent there instead of into the drawing).
 *
 * The bars use one hue in five steps, light to dark, because the buckets are a severity scale; the status
 * palette is reserved for states and is deliberately not reused here.
 */

export type Point = { label: string; value: number; display: string };

const PADDING = { left: 8, right: 8, top: 12, bottom: 24 };
const HEIGHT = 180;
const WIDTH = 640;
/** Single-hue sequential ramp on the brand hue; index 0 is "newest", the last step is the oldest debt. */
const BUCKET_STEPS = ['hsl(174 60% 72%)', 'hsl(174 68% 58%)', 'hsl(174 76% 44%)', 'hsl(174 84% 34%)', 'hsl(174 88% 24%)'];

function useHover() {
  const [active, setActive] = useState<number | null>(null);
  return { active, setActive };
}

function Tooltip({ point, x, align }: { point: Point; x: number; align: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={PADDING.top - 2} textAnchor={align} className="fill-foreground text-[11px] font-medium">
      {point.label} · {point.display}
    </text>
  );
}

function EmptyNote({ children }: { children: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

/** A measure over time (sales, payments, purchases). */
export function LineChart({ points, caption }: { points: Point[]; caption: string }) {
  const { t } = useTranslation();
  const { active, setActive } = useHover();
  const titleId = useId();
  if (points.length === 0) return <EmptyNote>{t('reports.chart.empty')}</EmptyNote>;

  const max = Math.max(...points.map((point) => point.value), 1);
  const inner = { width: WIDTH - PADDING.left - PADDING.right, height: HEIGHT - PADDING.top - PADDING.bottom };
  const step = points.length > 1 ? inner.width / (points.length - 1) : 0;
  const position = (point: Point, index: number) => ({
    x: PADDING.left + (points.length > 1 ? index * step : inner.width / 2),
    y: PADDING.top + inner.height - (point.value / max) * inner.height,
  });
  const path = points.map((point, index) => {
    const { x, y } = position(point, index);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full" role="img" aria-labelledby={titleId} preserveAspectRatio="none">
        <title id={titleId}>{caption}</title>
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={PADDING.top + inner.height * fraction}
            y2={PADDING.top + inner.height * fraction}
            className="stroke-border"
            strokeWidth={1}
          />
        ))}
        <path d={path.join(' ')} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} strokeLinejoin="round" />
        {points.map((point, index) => {
          const { x, y } = position(point, index);
          return (
            <g key={point.label} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}>
              <circle cx={x} cy={y} r={index === active ? 6 : 4} fill="hsl(var(--primary))" stroke="hsl(var(--surface))" strokeWidth={2} />
              {/* A hit target larger than the marker, so the hover is reachable on a dense series. */}
              <rect x={x - 12} y={PADDING.top} width={24} height={inner.height} fill="transparent" />
            </g>
          );
        })}
        {active !== null && points[active] ? (
          <Tooltip point={points[active]} x={Math.min(Math.max(position(points[active], active).x, 60), WIDTH - 60)} align="middle" />
        ) : null}
        <text x={PADDING.left} y={HEIGHT - 6} className="fill-muted-foreground text-[11px]">
          {points[0]?.label}
        </text>
        {points.length > 1 ? (
          <text x={WIDTH - PADDING.right} y={HEIGHT - 6} textAnchor="end" className="fill-muted-foreground text-[11px]">
            {points[points.length - 1]?.label}
          </text>
        ) : null}
      </svg>
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

/** Magnitude by bucket (receivables aging, debt by partner). */
export function BarChart({ points, caption }: { points: Point[]; caption: string }) {
  const { t } = useTranslation();
  const { active, setActive } = useHover();
  const titleId = useId();
  if (points.length === 0) return <EmptyNote>{t('reports.chart.empty')}</EmptyNote>;

  const max = Math.max(...points.map((point) => point.value), 1);
  const inner = { width: WIDTH - PADDING.left - PADDING.right, height: HEIGHT - PADDING.top - PADDING.bottom };
  // A 2px gap of surface between neighbours, so two adjacent bars never read as one shape.
  const slot = inner.width / points.length;
  const barWidth = Math.max(slot - 2, 4);

  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{caption}</title>
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={PADDING.top + inner.height}
          y2={PADDING.top + inner.height}
          className="stroke-border"
          strokeWidth={1}
        />
        {points.map((point, index) => {
          const height = Math.max((point.value / max) * inner.height, point.value > 0 ? 2 : 0);
          const x = PADDING.left + index * slot + (slot - barWidth) / 2;
          return (
            <g key={point.label} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}>
              <rect
                x={x}
                y={PADDING.top + inner.height - height}
                width={barWidth}
                height={height}
                rx={4}
                fill={BUCKET_STEPS[Math.min(index, BUCKET_STEPS.length - 1)]}
                opacity={active === null || active === index ? 1 : 0.75}
              />
              <text x={x + barWidth / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {point.label}
              </text>
            </g>
          );
        })}
        {active !== null && points[active] ? (
          <Tooltip point={points[active]} x={Math.min(Math.max(PADDING.left + active * slot + slot / 2, 60), WIDTH - 60)} align="middle" />
        ) : null}
      </svg>
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
