import { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Brand } from '../components/Brand';
import { createRoomCode, roomUrl } from '../lib/room';

function initialRoom() {
  const queryRoom = new URLSearchParams(window.location.search).get('room');
  if (queryRoom) return queryRoom.toUpperCase();
  const savedRoom = sessionStorage.getItem('lampei-room');
  return savedRoom ?? createRoomCode();
}

export function HomePage() {
  const [room, setRoom] = useState(initialRoom);
  const [copied, setCopied] = useState<'sender' | 'receiver' | null>(null);
  const senderUrl = useMemo(() => roomUrl('/sender', room), [room]);
  const receiverUrl = useMemo(() => roomUrl('/receiver', room), [room]);

  const regenerate = () => {
    const nextRoom = createRoomCode();
    sessionStorage.setItem('lampei-room', nextRoom);
    setRoom(nextRoom);
  };

  const copy = async (kind: 'sender' | 'receiver', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  };

  return (
    <main className="home-shell">
      <nav className="topbar">
        <Brand />
        <span className="topbar__tag">WebRTC · PWA</span>
      </nav>

      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">TU TELÉFONO. OTRA CÁMARA.</p>
          <h1>
            Cámara móvil,
            <span>directo a OBS.</span>
          </h1>
          <p className="hero__lead">
            Convierte un iPhone o Android en una fuente inalámbrica de baja latencia. Sin cables,
            sin registro y sin instalar una app de escritorio.
          </p>
          <div className="hero__features" aria-label="Características">
            <span>1080p</span>
            <span>Audio</span>
            <span>Punto a punto</span>
          </div>
        </div>

        <div className="pair-card">
          <div className="pair-card__heading">
            <div>
              <p className="step-label">SESIÓN ACTIVA</p>
              <h2>{room}</h2>
            </div>
            <button className="icon-button" type="button" onClick={regenerate} aria-label="Crear otro código">
              ↻
            </button>
          </div>

          <div className="qr-wrap">
            <QRCodeSVG
              value={senderUrl}
              size={190}
              bgColor="transparent"
              fgColor="#080b0f"
              level="M"
              marginSize={2}
            />
          </div>
          <p className="qr-caption">Escanea con la cámara de tu teléfono</p>
          <a className="primary-button" href={senderUrl}>
            Abrir cámara en este equipo <span>→</span>
          </a>
        </div>
      </section>

      <section className="setup-grid">
        <article className="setup-card">
          <div className="setup-card__number">01</div>
          <div>
            <p className="step-label">TELÉFONO</p>
            <h3>Abre y transmite</h3>
            <p>Escanea el QR, permite cámara y micrófono, y toca “Iniciar cámara”.</p>
          </div>
          <button className="text-button" type="button" onClick={() => copy('sender', senderUrl)}>
            {copied === 'sender' ? 'Enlace copiado' : 'Copiar enlace móvil'}
          </button>
        </article>

        <article className="setup-card setup-card--accent">
          <div className="setup-card__number">02</div>
          <div>
            <p className="step-label">OBS STUDIO</p>
            <h3>Agrega la señal</h3>
            <p>Crea una Fuente de navegador, usa 1920 × 1080 y pega este enlace.</p>
          </div>
          <div className="url-field">
            <span>{receiverUrl}</span>
            <button type="button" onClick={() => copy('receiver', receiverUrl)}>
              {copied === 'receiver' ? '✓' : 'Copiar'}
            </button>
          </div>
        </article>

        <article className="setup-card setup-card--note">
          <div className="signal-icon" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div>
            <p className="step-label">CONSEJO</p>
            <h3>Misma red, mejor señal</h3>
            <p>Conecta el teléfono y la PC al mismo Wi-Fi 5 GHz. Desactiva “Aislamiento de clientes” en el router.</p>
          </div>
        </article>
      </section>

      <footer className="footer">
        <span>Lampei Cam · MVP local</span>
        <span>La señal de video viaja directamente entre tus dispositivos.</span>
      </footer>
    </main>
  );
}

