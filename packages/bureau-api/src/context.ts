import type { BureauChain } from "./chain.ts";
import type { BureauConfig } from "./config.ts";
import type { BureauDatabase } from "./db.ts";
import type { EventHub } from "./events.ts";

export interface AppContext {
  config: BureauConfig;
  db: BureauDatabase;
  events: EventHub;
  chain: BureauChain;
}
