import type { IncusClient } from "./incus.ts";

type AsciinemaIncus = Pick<IncusClient, "exec" | "filePushContent">;

export interface StreamProvision {
  installId: string;
  publicToken: string;
  producerToken: string;
  playerWsPath: string;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STREAM_TOKEN = /^[A-Za-z0-9]{16}$/;

export function parseProvisionOutput(rawOutput: string): StreamProvision {
  const parts = rawOutput.trim().split(/\s+/);
  const [installId, publicToken, producerToken] = parts;
  if (parts.length !== 3
    || installId === undefined
    || publicToken === undefined
    || producerToken === undefined
    || !UUID_V4.test(installId)
    || !STREAM_TOKEN.test(publicToken)
    || !STREAM_TOKEN.test(producerToken)) {
    throw new Error(`invalid asciinema provisioning output: ${rawOutput}`);
  }
  return {
    installId,
    publicToken,
    producerToken,
    playerWsPath: `/ws/s/${publicToken}`,
  };
}

export async function pushStreamCredentials(
  incus: AsciinemaIncus,
  participantName: string,
  installId: string,
  publicToken: string,
): Promise<void> {
  await incus.exec(participantName, [
    "install", "-d", "-m", "0700", "-o", "operative", "-g", "operative",
    "/home/operative/.local",
    "/home/operative/.local/state",
    "/home/operative/.local/state/asciinema",
    "/home/operative/.config",
    "/home/operative/.config/asciinema",
  ]);
  const uidOutput = await incus.exec(participantName, ["id", "-u", "operative"]);
  if (!/^\d+$/.test(uidOutput)) throw new Error(`invalid operative uid returned by ${participantName}`);
  const uid = Number(uidOutput);
  const currentInstallId = "/home/operative/.local/state/asciinema/install-id";
  const legacyInstallId = "/home/operative/.config/asciinema/install-id";
  const streamToken = "/home/operative/.config/asciinema/stream-token";
  await incus.filePushContent(`${installId}\n`, participantName, currentInstallId, 0o600, uid);
  await incus.filePushContent(`${installId}\n`, participantName, legacyInstallId, 0o600, uid);
  await incus.filePushContent(`${publicToken}\n`, participantName, streamToken, 0o600, uid);
  await incus.exec(participantName, [
    "chown", "operative:operative", currentInstallId, legacyInstallId, streamToken,
  ]);
}

export async function provisionStream(
  incus: AsciinemaIncus,
  participantName: string,
  username: string,
): Promise<StreamProvision> {
  const rawOutput = await incus.exec("admin", ["/usr/local/bin/provision-stream", username]);
  const provision = parseProvisionOutput(rawOutput);
  await pushStreamCredentials(incus, participantName, provision.installId, provision.publicToken);
  return provision;
}
