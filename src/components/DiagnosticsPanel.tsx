import type { ConnectionStats } from '../lib/stats';

type Tone = 'ok' | 'warn' | 'bad' | 'plain';

const ROUTES: Record<string, { label: string; tone: Tone; hint: string }> = {
  host: { label: 'LOCAL', tone: 'ok', hint: 'Conexión directa en la misma red' },
  srflx: { label: 'NAT', tone: 'warn', hint: 'Atravesó el NAT sin relay' },
  prflx: { label: 'NAT', tone: 'warn', hint: 'Atravesó el NAT sin relay' },
  relay: { label: 'RELAY', tone: 'warn', hint: 'Pasando por un servidor TURN' },
};

const LIMITS: Record<string, { label: string; tone: Tone; hint?: string }> = {
  none: { label: 'NINGUNO', tone: 'ok' },
  cpu: { label: 'CPU', tone: 'bad', hint: 'El teléfono no alcanza a codificar' },
  bandwidth: { label: 'RED', tone: 'warn', hint: 'No hay ancho de banda suficiente' },
  other: { label: 'OTRO', tone: 'warn' },
};

function Row({
  label,
  value,
  tone = 'plain',
  hint,
}: {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className="diag-row">
      <dt>{label}</dt>
      <dd>
        <span className={`diag-value diag-value--${tone}`}>{value}</span>
        {hint && <span className="diag-hint">{hint}</span>}
      </dd>
    </div>
  );
}

export function DiagnosticsPanel({ stats }: { stats?: ConnectionStats }) {
  if (!stats) {
    return (
      <div className="diagnostics">
        <p className="diagnostics__empty">
          Sin enlace activo. Los datos aparecen cuando OBS conecta.
        </p>
      </div>
    );
  }

  const route = stats.route ? ROUTES[stats.route] : undefined;
  const limit = stats.limitation ? LIMITS[stats.limitation] : undefined;

  const rttTone: Tone =
    stats.rttMs === undefined ? 'plain' : stats.rttMs < 50 ? 'ok' : stats.rttMs < 150 ? 'warn' : 'bad';
  const lossTone: Tone =
    stats.lossPct === undefined ? 'plain' : stats.lossPct < 1 ? 'ok' : stats.lossPct < 3 ? 'warn' : 'bad';
  const codecTone: Tone = stats.codec === undefined ? 'plain' : stats.codec === 'H264' ? 'ok' : 'warn';

  const resolution =
    stats.frameWidth && stats.frameHeight
      ? `${stats.frameWidth}×${stats.frameHeight}${stats.fps ? ` · ${Math.round(stats.fps)} fps` : ''}`
      : '—';

  return (
    <dl className="diagnostics">
      <Row
        label="RUTA"
        value={route?.label ?? (stats.route ?? '—').toUpperCase()}
        tone={route?.tone ?? 'plain'}
        hint={route?.hint}
      />
      <Row
        label="ENVÍO"
        value={stats.bitrateKbps === undefined ? '—' : `${stats.bitrateKbps} kbps`}
        hint={stats.availableKbps === undefined ? undefined : `Disponible ${stats.availableKbps} kbps`}
      />
      <Row
        label="LÍMITE"
        value={limit?.label ?? (stats.limitation ?? '—').toUpperCase()}
        tone={limit?.tone ?? 'plain'}
        hint={limit?.hint}
      />
      <Row label="RTT" value={stats.rttMs === undefined ? '—' : `${stats.rttMs} ms`} tone={rttTone} />
      <Row
        label="PÉRDIDA"
        value={stats.lossPct === undefined ? '—' : `${stats.lossPct}%`}
        tone={lossTone}
      />
      <Row label="VIDEO" value={resolution} />
      <Row
        label="CODEC"
        value={stats.codec ?? '—'}
        tone={codecTone}
        hint={codecTone === 'warn' ? 'Sin encoder de hardware' : undefined}
      />
    </dl>
  );
}
