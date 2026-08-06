export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-muted p-6 text-sm text-text-muted" role="status">
      {text}
    </div>
  );
}
