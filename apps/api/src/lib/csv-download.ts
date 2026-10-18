import { PassThrough, type Readable } from "node:stream";
import type { Database, DatabaseTransaction } from "../db/client";

const BYTE_ORDER_MARK = "﻿";
const TIME_LIMIT_MS = 120_000;

export type CsvWriter = {
  /** Call once checks have passed and rows are about to flow; before this, errors become normal responses. */
  begin: () => void;
  write: (text: string) => Promise<void>;
};

/**
 * Runs `produce` in one read-only repeatable-read snapshot and hands back a stream of what it
 * writes, with backpressure. Nothing is written to disk or the database: the CSV exists only in
 * memory in transit, and is gone when the download ends or is abandoned.
 */
export function csvDownload(
  db: Database,
  produce: (tx: DatabaseTransaction, csv: CsvWriter) => Promise<void>,
): Promise<Readable> {
  const stream = new PassThrough();
  return new Promise((resolve, reject) => {
    let started = false;
    const timer = setTimeout(
      () => stream.destroy(new Error("Export timed out")),
      TIME_LIMIT_MS,
    );
    const csv: CsvWriter = {
      begin: () => {
        started = true;
        stream.write(BYTE_ORDER_MARK);
        resolve(stream);
      },
      write: async (text) => {
        if (stream.destroyed) throw new Error("Download closed");
        if (stream.write(text)) return;
        await new Promise<void>((done) => {
          const finish = () => {
            stream.off("drain", finish);
            stream.off("close", finish);
            done();
          };
          stream.once("drain", finish);
          stream.once("close", finish);
        });
        if (stream.destroyed) throw new Error("Download closed");
      },
    };
    db.transaction((tx) => produce(tx, csv), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    })
      .then(
        () => {
          if (!started) csv.begin();
          stream.end();
        },
        (error) => {
          if (started) stream.destroy(error);
          else reject(error);
        },
      )
      .finally(() => clearTimeout(timer));
  });
}
