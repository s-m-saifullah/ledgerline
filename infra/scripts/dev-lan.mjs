import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { pathToFileURL } from "node:url";

// Runs the dev servers so a phone or another computer on the same network can open the app.
// Nothing is written to .env: APP_URL is set for this run only (Node's --env-file never overrides
// variables that are already set). The web server listens on all interfaces; the API stays on
// localhost because Vite proxies /api to it.
const privateRange = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** The first private IPv4 address of a non-internal network interface, preferring en0 and wlan0. */
export function pickLanAddress(interfaces) {
  const candidates = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const item of addresses ?? []) {
      if (
        item.family === "IPv4" &&
        !item.internal &&
        privateRange.test(item.address)
      )
        candidates.push({ name, address: item.address });
    }
  }
  const preferred = candidates.find((item) =>
    /^(en0|wlan0|wlp)/.test(item.name),
  );
  return (preferred ?? candidates[0])?.address ?? null;
}

export function parseAddressArgument(args) {
  const argument = args.find((item) => item.startsWith("--ip="));
  if (!argument) return null;
  const value = argument.slice("--ip=".length);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value))
    throw new Error("Use --ip=<IPv4 address>, for example --ip=192.168.1.20");
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(".env")) {
    console.error("Run pnpm setup first.");
    process.exit(1);
  }
  let address;
  try {
    address =
      parseAddressArgument(process.argv.slice(2)) ??
      pickLanAddress(networkInterfaces());
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!address) {
    console.error(
      "No local network address found. Connect to Wi-Fi or pass --ip=<address>.",
    );
    process.exit(1);
  }
  const database = spawnSync("pnpm", ["db:up"], { stdio: "inherit" });
  if (database.status !== 0) process.exit(database.status ?? 1);
  const url = `http://${address}:5173`;
  const env = { ...process.env, APP_URL: url };
  console.log(
    `\nOpen ${url} on your phone (same Wi-Fi). Use this address on this computer too, not localhost.`,
  );
  console.log(
    "This is plain HTTP on your local network: use it with test data only, never production data.\n",
  );
  const children = [
    spawn("pnpm", ["--filter", "@ledgerline/api", "dev"], {
      stdio: "inherit",
      env,
    }),
    spawn(
      "pnpm",
      ["--filter", "@ledgerline/web", "exec", "vite", "--host", "0.0.0.0"],
      { stdio: "inherit", env },
    ),
  ];
  const stop = (signal) => {
    for (const child of children) child.kill(signal);
  };
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => stop(signal));
  let exiting = false;
  for (const child of children)
    child.on("exit", (code) => {
      if (exiting) return;
      exiting = true;
      process.exitCode = code ?? 0;
      stop("SIGTERM");
    });
}
