import { useEffect, useState } from 'react';

export type ConnectionStats = {
  route?: string;
  protocol?: string;
  bitrateKbps?: number;
  availableKbps?: number;
  limitation?: string;
  rttMs?: number;
  lossPct?: number;
  frameWidth?: number;
  frameHeight?: number;
  fps?: number;
  codec?: string;
};

type StatRecord = Record<string, unknown>;
type StatsMap = Map<string, StatRecord>;

type Sample = {
  timestamp: number;
  bytesSent: number;
  packetsSent: number;
  packetsLost: number;
};

function toNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toText(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function findSelectedPair(report: StatsMap) {
  let transport: StatRecord | undefined;
  let fallback: StatRecord | undefined;

  report.forEach((entry) => {
    if (entry.type === 'transport') transport = entry;
    if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.nominated === true) {
      fallback = entry;
    }
  });

  const selectedId = toText(transport?.selectedCandidatePairId);
  return (selectedId ? report.get(selectedId) : undefined) ?? fallback;
}

function collect(report: StatsMap, previous: Sample | undefined) {
  let outbound: StatRecord | undefined;
  let remoteInbound: StatRecord | undefined;

  report.forEach((entry) => {
    if (entry.type === 'outbound-rtp' && entry.kind === 'video') outbound = entry;
    if (entry.type === 'remote-inbound-rtp' && entry.kind === 'video') remoteInbound = entry;
  });

  const pair = findSelectedPair(report);
  const localCandidateId = toText(pair?.localCandidateId);
  const localCandidate = localCandidateId ? report.get(localCandidateId) : undefined;

  const codecId = toText(outbound?.codecId);
  const codec = codecId ? report.get(codecId) : undefined;

  const stats: ConnectionStats = {
    route: toText(localCandidate?.candidateType),
    protocol: toText(localCandidate?.protocol)?.toUpperCase(),
    limitation: toText(outbound?.qualityLimitationReason),
    frameWidth: toNumber(outbound?.frameWidth),
    frameHeight: toNumber(outbound?.frameHeight),
    fps: toNumber(outbound?.framesPerSecond),
    codec: toText(codec?.mimeType)?.replace(/^video\//i, '').toUpperCase(),
  };

  const availableBps = toNumber(pair?.availableOutgoingBitrate);
  if (availableBps !== undefined) stats.availableKbps = Math.round(availableBps / 1000);

  // The receiver reports loss and round trip back over RTCP, so the phone alone
  // can tell how the far end is actually doing.
  const rttSeconds = toNumber(remoteInbound?.roundTripTime) ?? toNumber(pair?.currentRoundTripTime);
  if (rttSeconds !== undefined) stats.rttMs = Math.round(rttSeconds * 1000);

  const sample: Sample | undefined =
    toNumber(outbound?.bytesSent) !== undefined
      ? {
          timestamp: toNumber(outbound?.timestamp) ?? Date.now(),
          bytesSent: toNumber(outbound?.bytesSent) ?? 0,
          packetsSent: toNumber(outbound?.packetsSent) ?? 0,
          packetsLost: toNumber(remoteInbound?.packetsLost) ?? 0,
        }
      : undefined;

  if (sample && previous) {
    const elapsed = (sample.timestamp - previous.timestamp) / 1000;
    if (elapsed > 0) {
      stats.bitrateKbps = Math.round(((sample.bytesSent - previous.bytesSent) * 8) / elapsed / 1000);
    }
    // Rate over the last interval, not since the call started: a bad patch early
    // on would otherwise keep the average red for the rest of the service.
    const sent = sample.packetsSent - previous.packetsSent;
    const lost = sample.packetsLost - previous.packetsLost;
    if (sent > 0 && lost >= 0) stats.lossPct = Math.round((lost / (sent + lost)) * 1000) / 10;
  }

  return { stats, sample };
}

export function useSenderStats(
  peerRef: { current: RTCPeerConnection | undefined },
  enabled: boolean,
) {
  const [stats, setStats] = useState<ConnectionStats | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setStats(undefined);
      return;
    }

    let cancelled = false;
    let previous: Sample | undefined;

    const read = async () => {
      const peer = peerRef.current;
      if (!peer || peer.connectionState !== 'connected') {
        if (!cancelled) setStats(undefined);
        previous = undefined;
        return;
      }
      try {
        const report = (await peer.getStats()) as unknown as StatsMap;
        const { stats: next, sample } = collect(report, previous);
        previous = sample;
        if (!cancelled) setStats(next);
      } catch {
        // A peer can close mid-read; the next tick picks it back up.
      }
    };

    void read();
    const timer = window.setInterval(() => void read(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, peerRef]);

  return stats;
}
