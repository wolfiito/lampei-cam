import { useCallback, useEffect, useRef, useState } from 'react';
import { Brand } from '../components/Brand';
import { StatusPill } from '../components/StatusPill';
import { getRoomFromUrl, isValidRoom } from '../lib/room';
import {
  rtcConfiguration,
  SignalingClient,
  type SignalPayload,
  type SignalingState,
} from '../lib/signaling';

type CameraState = 'idle' | 'starting' | 'ready' | 'error';
type FacingMode = 'environment' | 'user';

export function SenderPage() {
  const room = getRoomFromUrl();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const peerRef = useRef<RTCPeerConnection | undefined>(undefined);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const signalingRef = useRef<SignalingClient | undefined>(undefined);
  const wakeLockRef = useRef<WakeLockSentinel | undefined>(undefined);
  const startCameraRef = useRef<((facing?: FacingMode) => Promise<void>) | undefined>(undefined);
  const detachTrackListenersRef = useRef<(() => void) | undefined>(undefined);
  const restartingRef = useRef(false);
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [signalState, setSignalState] = useState<SignalingState>('connecting');
  const [peerState, setPeerState] = useState<RTCPeerConnectionState>('new');
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [resolution, setResolution] = useState('—');

  const closePeer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = undefined;
    pendingCandidates.current = [];
    setPeerState('new');
  }, []);

  const createPeer = useCallback(() => {
    closePeer();
    const peer = new RTCPeerConnection(rtcConfiguration);
    peerRef.current = peer;
    streamRef.current?.getTracks().forEach((track) => peer.addTrack(track, streamRef.current!));
    peer.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        signalingRef.current?.send({
          type: 'signal',
          payload: { candidate: event.candidate.toJSON() },
        });
      }
    });
    peer.addEventListener('connectionstatechange', () => {
      if (peerRef.current !== peer) return;
      setPeerState(peer.connectionState);
      if (peer.connectionState === 'failed') {
        // The receiver owns renegotiation: ask it for a fresh offer.
        signalingRef.current?.send({ type: 'ready' });
      }
    });
    return peer;
  }, [closePeer]);

  useEffect(() => {
    if (!isValidRoom(room)) return;
    const signaling = new SignalingClient('sender', room);
    signalingRef.current = signaling;
    const removeState = signaling.onState(setSignalState);
    const removeMessage = signaling.onMessage(async (message) => {
      if (message.type === 'signal') {
        const payload = message.payload;
        try {
          if ('description' in payload && payload.description.type === 'offer') {
            const peer = createPeer();
            await peer.setRemoteDescription(payload.description);
            for (const candidate of pendingCandidates.current.splice(0)) {
              await peer.addIceCandidate(candidate);
            }
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            signaling.send({ type: 'signal', payload: { description: answer } });
          } else if ('candidate' in payload) {
            if (peerRef.current?.remoteDescription) {
              await peerRef.current.addIceCandidate(payload.candidate);
            } else {
              pendingCandidates.current.push(payload.candidate);
            }
          }
        } catch (reason) {
          setError(`No se pudo negociar la señal: ${String(reason)}`);
        }
      }
      if (
        message.type === 'peer-joined' &&
        message.role === 'receiver' &&
        streamRef.current?.getVideoTracks().some((track) => track.readyState === 'live')
      ) {
        signaling.send({ type: 'ready' });
      }
      if (message.type === 'peer-left') closePeer();
    });
    signaling.connect();
    return () => {
      removeState();
      removeMessage();
      signaling.close();
      closePeer();
    };
  }, [closePeer, createPeer, room]);

  useEffect(() => {
    if (cameraState === 'ready' && signalState === 'connected') {
      signalingRef.current?.send({ type: 'ready' });
    }
  }, [cameraState, signalState]);

  useEffect(() => {
    return () => {
      detachTrackListenersRef.current?.();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      wakeLockRef.current?.release().catch(() => undefined);
    };
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator) || wakeLockRef.current) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLockRef.current = lock;
      lock.addEventListener('release', () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = undefined;
      });
    } catch {
      // The system can refuse the lock (low battery); retried on the next foreground.
    }
  }, []);

  // The OS revokes the wake lock whenever the tab loses visibility, so it has to be
  // taken again on every return to the foreground or the phone sleeps mid-stream.
  useEffect(() => {
    if (cameraState !== 'ready') return;
    void acquireWakeLock();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [acquireWakeLock, cameraState]);

  const startCamera = useCallback(
    async (nextFacingMode = facingMode) => {
      setCameraState('starting');
      setError('');
      detachTrackListenersRef.current?.();
      streamRef.current?.getTracks().forEach((track) => track.stop());

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: nextFacingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        // iOS ends the track when a call arrives or another app grabs the camera.
        // track.stop() does not fire 'ended', so this only reacts to real interruptions.
        const handleTrackEnded = () => {
          if (restartingRef.current) return;
          restartingRef.current = true;
          closePeer();
          setError('Se interrumpió la cámara. Reconectando…');
          window.setTimeout(() => {
            restartingRef.current = false;
            void startCameraRef.current?.(nextFacingMode);
          }, 800);
        };
        const tracks = stream.getTracks();
        tracks.forEach((track) => track.addEventListener('ended', handleTrackEnded));
        detachTrackListenersRef.current = () => {
          tracks.forEach((track) => track.removeEventListener('ended', handleTrackEnded));
          detachTrackListenersRef.current = undefined;
        };

        const settings = stream.getVideoTracks()[0]?.getSettings();
        setResolution(settings?.width && settings.height ? `${settings.width} × ${settings.height}` : 'Activa');
        stream.getAudioTracks().forEach((track) => (track.enabled = !muted));
        setCameraState('ready');
      } catch (reason) {
        setCameraState('error');
        const message = reason instanceof DOMException ? reason.name : String(reason);
        setError(
          message === 'NotAllowedError'
            ? 'No hay permiso para usar cámara o micrófono. Revisa los permisos del navegador y que el enlace use HTTPS.'
            : `No se pudo abrir la cámara: ${message}`,
        );
      }
    },
    [closePeer, facingMode, muted],
  );

  useEffect(() => {
    startCameraRef.current = startCamera;
  }, [startCamera]);

  const flipCamera = async () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    closePeer();
    await startCamera(next);
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = !nextMuted));
  };

  if (!isValidRoom(room)) {
    return <InvalidRoom />;
  }

  const isLive = peerState === 'connected';

  return (
    <main className="camera-page">
      <video ref={videoRef} className="camera-preview" autoPlay playsInline muted />
      <div className="camera-shade" />

      <header className="camera-header">
        <Brand compact />
        <StatusPill tone={isLive ? 'live' : signalState === 'connected' ? 'warning' : 'idle'}>
          {isLive ? 'EN VIVO' : signalState === 'connected' ? 'ESPERANDO OBS' : 'RECONECTANDO'}
        </StatusPill>
      </header>

      {cameraState !== 'ready' && (
        <section className="camera-start">
          <span className="camera-start__icon" aria-hidden="true">●</span>
          <p className="step-label">SESIÓN {room}</p>
          <h1>Tu cámara está lista</h1>
          <p>La imagen solo se transmitirá cuando autorices el acceso.</p>
          <button className="primary-button primary-button--large" onClick={() => startCamera()} disabled={cameraState === 'starting'}>
            {cameraState === 'starting' ? 'Abriendo cámara…' : 'Iniciar cámara'}
          </button>
          {error && <p className="error-message">{error}</p>}
        </section>
      )}

      {cameraState === 'ready' && (
        <footer className="camera-controls">
          <div className="camera-metadata">
            <span>{resolution}</span>
            <span>{room}</span>
          </div>
          <div className="control-row">
            <button type="button" onClick={toggleMute} className={muted ? 'is-active' : ''}>
              <span aria-hidden="true">{muted ? '×' : ')))'}</span>
              {muted ? 'Sin audio' : 'Audio'}
            </button>
            <button type="button" onClick={flipCamera}>
              <span aria-hidden="true">↻</span>
              Voltear
            </button>
            <a href="/">
              <span aria-hidden="true">■</span>
              Terminar
            </a>
          </div>
          {error && <p className="error-message">{error}</p>}
        </footer>
      )}
    </main>
  );
}

function InvalidRoom() {
  return (
    <main className="centered-message">
      <Brand />
      <h1>Falta el código de sesión</h1>
      <p>Vuelve al inicio y crea una sesión para conectar tu cámara.</p>
      <a className="primary-button" href="/">Ir al inicio</a>
    </main>
  );
}
