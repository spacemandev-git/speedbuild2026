export interface ExecutorConfig {
  estateSecret: string;
  adminToken: string;
  rpcUrl: string;
  wsUrl: string;
  estateDeployerPath: string;
  scripMintPath: string;
  dbPath: string;
  idlPath: string;
  deployDir: string;
  claimantRegistryPath: string;
  ports: {
    public: number;
    facilitator: number;
    trapFacilitator: number;
    ledger: number;
    admin: number;
  };
}

export const PORTS = {
  public: 8700,
  facilitator: 8701,
  trapFacilitator: 8702,
  ledger: 8703,
  admin: 8710,
} as const;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ExecutorConfig {
  return {
    estateSecret: required(env, "SB_ESTATE_SECRET"),
    adminToken: required(env, "SB_ADMIN_TOKEN"),
    rpcUrl: env.RPC_URL ?? "http://127.0.0.1:8899",
    wsUrl: env.WS_URL ?? "ws://127.0.0.1:8900",
    estateDeployerPath: env.ESTATE_DEPLOYER ?? "/var/lib/estate/deployer.json",
    scripMintPath: env.SCRIP_MINT_PATH ?? env.SCRIP_MINT ?? "/var/lib/estate/scrip-mint.json",
    dbPath: env.DB_PATH ?? "/var/lib/executor/state.sqlite",
    idlPath: env.IDL_PATH ?? env.ESTATE_IDL ?? "/opt/packages/estate-registry/target/idl/estate_registry.json",
    deployDir: env.DEPLOY_DIR ?? "/opt/zone/deploy",
    claimantRegistryPath: env.CLAIMANTS_PATH ?? "/var/lib/estate/claimants.json",
    ports: PORTS,
  };
}
