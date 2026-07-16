interface BrandMarkProps {
  compact?: boolean;
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <span className="fo-brand" aria-label="FreeAI Open">
      <img
        className="fo-brand__icon"
        src="/brand/freeai-open-app-icon.png"
        alt=""
        width={compact ? 28 : 32}
        height={compact ? 28 : 32}
        aria-hidden="true"
      />
      {!compact && <span className="fo-brand__name">FreeAI Open</span>}
    </span>
  );
}
