import type { ParticipantRecord } from '$lib/server/upstream';

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function participantClaim(participant: ParticipantRecord): string {
  return stringValue(participant.claimNumber) ?? stringValue(participant.claim_number) ?? participant.name;
}

export function participantIp(participant: ParticipantRecord): string {
  return stringValue(participant.ip) ?? stringValue(participant.ipAddress) ?? '—';
}

export function participantSshPort(participant: ParticipantRecord): number | undefined {
  return numberValue(participant.sshPort) ?? numberValue(participant.ssh_port);
}

export function participantStatus(participant: ParticipantRecord): string {
  return stringValue(participant.status) ?? 'unknown';
}

export function participantRooms(participant: ParticipantRecord): string[] {
  const rooms = Array.isArray(participant.revealedRooms)
    ? participant.revealedRooms
    : Array.isArray(participant.revealed)
      ? participant.revealed
      : [];

  return rooms.map(String);
}

export function participantStreamToken(participant: ParticipantRecord): string | null {
  return stringValue(participant.streamToken) ?? stringValue(participant.asciinemaToken) ?? null;
}

export function participantPassword(participant: ParticipantRecord): string | undefined {
  return stringValue(participant.password) ?? stringValue(participant.sshPassword);
}

export function participantPublicKey(participant: ParticipantRecord): string | undefined {
  return (
    stringValue(participant.publicKey) ??
    stringValue(participant.pubkey) ??
    stringValue(participant.walletPublicKey) ??
    stringValue(participant.solanaPubkey)
  );
}

export function participantApiKey(participant: ParticipantRecord): string | undefined {
  return stringValue(participant.apiKey) ?? stringValue(participant.estateApiKey);
}

export function participantWarnings(participant: ParticipantRecord): string[] {
  const warnings = Array.isArray(participant.warnings)
    ? participant.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];
  const warning = stringValue(participant.warning);
  return warning ? [...warnings, warning] : warnings;
}

export function isParticipantRunning(participant: ParticipantRecord): boolean {
  const status = participantStatus(participant).toLowerCase();
  return status === 'running' || status === 'started' || status === 'active';
}
