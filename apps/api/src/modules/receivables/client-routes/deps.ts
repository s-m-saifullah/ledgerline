import type { Config } from "../../../config";
import type { Database } from "../../../db/client";
import type { Auth } from "../../auth/service";

/** What every client route group needs. */
export type ClientRouteDeps = { db: Database; config: Config; auth: Auth };
