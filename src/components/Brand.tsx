export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`brand ${compact ? 'brand--compact' : ''}`} href="/" aria-label="Lampei Cam, inicio">
      <span className="brand__mark" aria-hidden="true">
        <span />
      </span>
      <span>
        <strong>LAMPEI</strong>
        <small>CAM / OBS</small>
      </span>
    </a>
  );
}

