export function StatusPill({
  tone,
  children,
}: {
  tone: 'idle' | 'live' | 'warning';
  children: React.ReactNode;
}) {
  return (
    <span className={`status-pill status-pill--${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

