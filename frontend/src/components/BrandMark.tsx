type BrandMarkProps = { compact?: boolean };

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className={`brand-mark${compact ? ' brand-mark--compact' : ''}`} aria-label="TezFarmo">
      <span className="brand-mark__leaf" aria-hidden="true">⌁</span>
      <span>tez<span>farmo</span></span>
    </div>
  );
}
