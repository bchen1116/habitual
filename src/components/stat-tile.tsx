export function StatTile({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-2xl bg-card px-[18px] py-[18px]">
      <p className="type-display text-[38px] leading-none">{value}</p>
      <p className="type-overline mt-1 text-[13px] text-muted-foreground">{label}</p>
    </div>
  );
}
