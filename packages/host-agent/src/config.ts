export const ZONE_IPS = {
  admin: "10.61.0.10",
  challenges: "10.61.0.20",
} as const;

export const BUREAU_ADMIN_BASE = "http://10.61.0.20:8710";
export const ASCIINEMA_BASE = "http://10.61.0.10:4000";
export const HOST_AGENT_HOST = "10.61.0.1";
export const HOST_AGENT_PORT = 7000;

export interface Config {
  hostAgentToken: string;
  adminToken: string;
  subnetPrefix: string;
  sshPortBase: number;
  participantCount: number;
  statePath: string;
  contentDir: string;
  hostLanHint: string;
  sunburstOrKey?: string | undefined;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function integer(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be between 1 and 65535`);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const subnetPrefix = env.SB_SUBNET_PREFIX?.trim() || "10.61.0";
  if (!/^\d{1,3}(?:\.\d{1,3}){2}$/.test(subnetPrefix)) {
    throw new Error("SB_SUBNET_PREFIX must contain the first three IPv4 octets");
  }
  const octets = subnetPrefix.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) {
    throw new Error("SB_SUBNET_PREFIX contains an invalid IPv4 octet");
  }

  const participantCount = integer(env, "SB_PARTICIPANT_COUNT", 30);
  if (participantCount > 99 || participantCount + 100 > 254) {
    throw new Error("SB_PARTICIPANT_COUNT cannot exceed 99 or the participant subnet capacity");
  }
  const sshPortBase = integer(env, "SB_SSH_PORT_BASE", 2200);
  if (sshPortBase + participantCount > 65_535) {
    throw new Error("SB_SSH_PORT_BASE plus SB_PARTICIPANT_COUNT exceeds the TCP port range");
  }

  return {
    hostAgentToken: required(env, "SB_HOST_AGENT_TOKEN"),
    adminToken: required(env, "SB_ADMIN_TOKEN"),
    subnetPrefix,
    sshPortBase,
    participantCount,
    statePath: env.STATE_PATH?.trim() || "/var/lib/speedbuild/state.json",
    contentDir: env.CONTENT_DIR?.trim() || "/opt/speedbuild/challenges-content",
    hostLanHint: env.SB_HOST_LAN_HINT?.trim() || "<host-lan-ip>",
    // Shared OpenRouter key for the default GPT 5.6 Sol model and the
    // selectable GLM 5.2 alternative. No model access is configured when unset.
    sunburstOrKey: env.SUNBURST_OR_KEY?.trim() || undefined,
  };
}
