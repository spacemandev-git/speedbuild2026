import { createConnection } from "node:net";
import { ZONE_IPS } from "./config.ts";
import type { IncusInstance } from "./incus.ts";
import { IncusClient } from "./incus.ts";

const ZONES = {
  admin: {
    ip: ZONE_IPS.admin,
    services: ["sb-dashboard", "docker"],
    ports: [3000, 4000],
  },
  challenges: {
    ip: ZONE_IPS.challenges,
    services: ["surfpool", "bureau-api"],
    ports: [8899, 8900, 8700, 8701, 8702, 8703, 8710],
  },
  inference: {
    ip: ZONE_IPS.inference,
    services: ["llama-server"],
    ports: [8080],
  },
} as const;

interface ServiceHealth {
  active: boolean;
  status: string;
}

interface TcpHealth {
  port: number;
  reachable: boolean;
}

export interface ZoneHealth {
  name: keyof typeof ZONES;
  ip: string;
  status: string;
  services: Record<string, ServiceHealth>;
  tcp: TcpHealth[];
  healthy: boolean;
}

function checkTcp(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function instanceStatus(instances: IncusInstance[], name: string): string {
  return instances.find((instance) => instance.name === name)?.status ?? "Missing";
}

export class ZoneMonitor {
  constructor(private readonly incus: IncusClient) {}

  private async service(name: string, service: string): Promise<[string, ServiceHealth]> {
    try {
      const status = (await this.incus.exec(name, ["systemctl", "is-active", service])).trim();
      return [service, { active: status === "active", status }];
    } catch (error) {
      const status = error instanceof Error ? error.message : "unknown error";
      return [service, { active: false, status }];
    }
  }

  async getZones(): Promise<Record<keyof typeof ZONES, ZoneHealth>> {
    const instances = await this.incus.list();
    const entries = await Promise.all(
      Object.entries(ZONES).map(async ([rawName, definition]) => {
        const name = rawName as keyof typeof ZONES;
        const [serviceEntries, tcp] = await Promise.all([
          Promise.all(definition.services.map((service) => this.service(name, service))),
          Promise.all(definition.ports.map(async (port) => ({ port, reachable: await checkTcp(definition.ip, port) }))),
        ]);
        const status = instanceStatus(instances, name);
        const services = Object.fromEntries(serviceEntries);
        const healthy = status.toLowerCase() === "running"
          && Object.values(services).every((service) => service.active)
          && tcp.every((check) => check.reachable);
        const health: ZoneHealth = { name, ip: definition.ip, status, services, tcp, healthy };
        return [name, health] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<keyof typeof ZONES, ZoneHealth>;
  }
}
