export interface BureauConfig {
  bureauSecret: string;
  adminToken: string;
  operativePool?: number;
  rpcUrl: string;
  wsUrl: string;
  bureauDeployerPath: string;
  credMintPath: string;
  dbPath: string;
  idlPath: string;
  deployDir: string;
  operativeRegistryPath: string;
  ports: {
    public: number;
    facilitator: number;
    trapFacilitator: number;
    room5: number;
    admin: number;
  };
}

export const PORTS = {
  public: 8700,
  facilitator: 8701,
  trapFacilitator: 8702,
  room5: 8703,
  admin: 8710,
} as const;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function operativePool(env: NodeJS.ProcessEnv): number {
  const value = Number(env.SB_OPERATIVE_POOL ?? "24");
  if (!Number.isInteger(value) || value < 16 || value > 99) {
    throw new Error("SB_OPERATIVE_POOL must be an integer between 16 and 99");
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BureauConfig & { operativePool: number } {
  return {
    bureauSecret: required(env, "SB_BUREAU_SECRET"),
    adminToken: required(env, "SB_ADMIN_TOKEN"),
    operativePool: operativePool(env),
    rpcUrl: env.RPC_URL ?? "http://127.0.0.1:8899",
    wsUrl: env.WS_URL ?? "ws://127.0.0.1:8900",
    bureauDeployerPath: env.BUREAU_DEPLOYER ?? "/var/lib/bureau/deployer.json",
    credMintPath: env.CRED_MINT_PATH ?? env.CRED_MINT ?? "/var/lib/bureau/cred-mint.json",
    dbPath: env.DB_PATH ?? "/var/lib/bureau-api/state.sqlite",
    idlPath: env.BUREAU_IDL ?? "/opt/packages/bureau-registry/target/idl/bureau_registry.json",
    deployDir: env.DEPLOY_DIR ?? "/opt/zone/deploy",
    operativeRegistryPath: env.OPERATIVES_PATH ?? "/var/lib/bureau/operatives.json",
    ports: PORTS,
  };
}
