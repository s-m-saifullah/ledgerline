import { PgBoss } from "pg-boss";

export type JobLog = {
  info: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
};
export const TICK_QUEUE = "tick";

/**
 * pg-boss only wakes the work up (ADR 0021 and 0024): once an hour and once at start. What is due
 * is always worked out from the tables, so losing the job tables loses nothing.
 */
export async function startJobRunner({
  connectionString,
  schema,
  tick,
  log,
}: {
  connectionString: string;
  schema?: string;
  tick: (now: Date) => Promise<unknown>;
  log: JobLog;
}) {
  const boss = new PgBoss({
    connectionString,
    ...(schema ? { schema } : {}),
  });
  // Error messages from the queue never include job data; log the message only.
  boss.on("error", (error) =>
    log.error({ message: error.message }, "Job queue error"),
  );
  await boss.start();
  await boss.createQueue(TICK_QUEUE);
  await boss.schedule(TICK_QUEUE, "0 * * * *");
  await boss.work(TICK_QUEUE, async () => {
    await tick(new Date());
  });
  // One tick at start catches up anything that came due while the server was down.
  await boss.send(
    TICK_QUEUE,
    {},
    { singletonKey: "start", singletonSeconds: 60 },
  );
  return { boss, stop: () => boss.stop({ graceful: true }) };
}
