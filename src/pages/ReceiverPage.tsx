import { useCallback, useEffect, useRef, useState } from 'react';
import { getRoomFromUrl, isValidRoom } from '../lib/room';
import { rtcConfiguration, SignalingClient, type SignalingState } from '../lib/signaling';

export function ReceiverPage() {
  const room = getRoomFromUrl();
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<RTCPeerConnection | undefined>(undefined);
  const signalingRef = useRef<SignalingClient | undefined>(undefined);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const negotiationRef = useRef(false);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const watchdogRef = useRef<number | undefined>(undefined);
  const retryAttemptRef = useRef(0);
  const senderPresentRef = useRef(false);
  const startOfferRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const [signalState, setSignalState] = useState<SignalingState>('connecting');
  const [peerState, setPeerState] = useState<RTCPeerConnectionState>('new');
  const [senderPresent, setSenderPresent] = useState(false);
  const [error, setError] = useState('');

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current !== undefined) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
    }
    if (watchdogRef.current !== undefined) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = undefined;
    }
  }, []);

  const nextBackoff = useCallback(() => {
    const delay = Math.min(1000 * 2 ** retryAttemptRef.current, 8000);
    retryAttemptRef.current += 1;
    return delay;
  }, []);

  const scheduleRetry = useCallback((delay: number) => {
    if (retryTimerRef.current !== undefined) return;
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = undefined;
      if (!senderPresentRef.current) return;
      negotiationRef.current = false;
      void startOfferRef.current?.();
    }, delay);
  }, []);

  const closePeer = useCallback(() => {
    clearTimers();
    peerRef.current?.close();
    peerRef.current = undefined;
    pendingCandidates.current = [];
    negotiationRef.current = false;
    setPeerState('new');
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [clearTimers]);

  useEffect(() => {
    senderPresentRef.current = senderPresent;
  }, [senderPresent]);

  const startOffer = useCallback(async () => {
    if (negotiationRef.current || signalingRef.current === undefined) return;
    closePeer();
    negotiationRef.current = true;
    setError('');

    try {
      const peer = new RTCPeerConnection(rtcConfiguration);
      peerRef.current = peer;
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.addTransceiver('audio', { direction: 'recvonly' });
      peer.addEventListener('track', (event) => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0] ?? new MediaStream([event.track]);
          videoRef.current.play().catch(() => undefined);
        }
      });
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
        if (peer.connectionState === 'connected') {
          negotiationRef.current = false;
          retryAttemptRef.current = 0;
          clearTimers();
        }
        if (peer.connectionState === 'disconnected') {
          // Usually a transient blip; give it room to heal before renegotiating.
          negotiationRef.current = false;
          scheduleRetry(5000);
        }
        if (peer.connectionState === 'failed') {
          negotiationRef.current = false;
          scheduleRetry(nextBackoff());
        }
      });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      signalingRef.current.send({ type: 'signal', payload: { description: offer } });

      // If the answer never lands the state machine stalls without ever reaching
      // 'failed', so re-offer instead of waiting forever.
      watchdogRef.current = window.setTimeout(() => {
        watchdogRef.current = undefined;
        if (peerRef.current !== peer || peer.connectionState === 'connected') return;
        negotiationRef.current = false;
        scheduleRetry(nextBackoff());
      }, 12_000);
    } catch (reason) {
      negotiationRef.current = false;
      setError(String(reason));
    }
  }, [clearTimers, closePeer, nextBackoff, scheduleRetry]);

  useEffect(() => {
    startOfferRef.current = startOffer;
  }, [startOffer]);

  useEffect(() => {
    if (!isValidRoom(room)) return;
    const signaling = new SignalingClient('receiver', room);
    signalingRef.current = signaling;
    const removeState = signaling.onState(setSignalState);
    const removeMessage = signaling.onMessage(async (message) => {
      if (message.type === 'welcome') {
        const present = message.peers.includes('sender');
        setSenderPresent(present);
      }
      if (message.type === 'peer-joined' && message.role === 'sender') {
        setSenderPresent(true);
      }
      if (message.type === 'ready') {
        setSenderPresent(true);
        await startOffer();
      }
      if (message.type === 'peer-left' && message.role === 'sender') {
        setSenderPresent(false);
        closePeer();
      }
      if (message.type === 'signal') {
        const payload = message.payload;
        try {
          const peer = peerRef.current;
          if (
            'description' in payload &&
            payload.description.type === 'answer' &&
            peer?.signalingState === 'have-local-offer'
          ) {
            await peer.setRemoteDescription(payload.description);
            for (const candidate of pendingCandidates.current.splice(0)) {
              await peer.addIceCandidate(candidate);
            }
          } else if ('candidate' in payload) {
            if (peerRef.current?.remoteDescription) {
              await peerRef.current.addIceCandidate(payload.candidate);
            } else {
              pendingCandidates.current.push(payload.candidate);
            }
          }
        } catch (reason) {
          setError(String(reason));
        }
      }
    });
    signaling.connect();
    return () => {
      removeState();
      removeMessage();
      signaling.close();
      closePeer();
    };
  }, [closePeer, room, startOffer]);

  const isLive = peerState === 'connected';

  return (
    <main className="receiver-page">
      <video ref={videoRef} autoPlay playsInline className={isLive ? 'is-live' : ''} />
      {!isLive && (
        <div className="receiver-placeholder">
          <div className="receiver-pulse" aria-hidden="true"><i /></div>
          <p className="step-label">LAMPEI CAM · {room || 'SIN SESIÓN'}</p>
          <h1>
            {!isValidRoom(room)
              ? 'Enlace de OBS incompleto'
              : signalState !== 'connected'
                ? 'Conectando al servidor…'
                : senderPresent
                  ? 'Recibiendo la cámara…'
                  : 'Esperando al teléfono'}
          </h1>
          <p>
            {!isValidRoom(room)
              ? 'Copia el enlace completo desde la pantalla de configuración.'
              : 'Mantén esta fuente activa. La imagen aparecerá automáticamente.'}
          </p>
          {error && <p className="error-message">{error}</p>}
        </div>
      )}
    </main>
  );
}
