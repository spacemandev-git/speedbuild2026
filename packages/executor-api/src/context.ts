import type { EstateChain } from "./chain.ts";
import type { ExecutorConfig } from "./config.ts";
import type { EstateDatabase } from "./db.ts";
import type { EventHub } from "./events.ts";

export interface AppContext {
  config: ExecutorConfig;
  db: EstateDatabase;
  events: EventHub;
  chain: EstateChain;
}
