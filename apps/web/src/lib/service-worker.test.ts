import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// Runs the real public/sw.js in a fake worker scope and checks what it will and will not touch (ADR 0041).
const source = readFileSync(
  resolve(__dirname, "../../public/sw.js"),
  "utf8",
).replace("__APP_VERSION__", "v-test");

type Listener = (event: Record<string, unknown>) => void;

function makeWorker(
  options: { network?: (url: string) => Response | Promise<Response> } = {},
) {
  const listeners: Record<string, Listener> = {};
  const stores = new Map<string, Map<string, Response>>();
  const key = (input: string | Request) =>
    new URL(
      typeof input === "string" ? input : input.url,
      "https://app.example",
    ).pathname;
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name) as Map<string, Response>;
    return Promise.resolve({
      put: (request: string | Request, response: Response) => {
        store.set(key(request), response);
        return Promise.resolve();
      },
    });
  };
  const fetched: string[] = [];
  const scope = {
    location: { origin: "https://app.example" },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
    caches: {
      open,
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (name: string) => Promise.resolve(stores.delete(name)),
      match: (request: string | Request) => {
        for (const store of stores.values()) {
          const hit = store.get(key(request));
          if (hit) return Promise.resolve(hit.clone());
        }
        return Promise.resolve(undefined);
      },
    },
    fetch: async (input: string | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input.url,
        "https://app.example",
      ).pathname;
      fetched.push(url);
      return (options.network ?? (() => new Response("", { status: 404 })))(
        url,
      );
    },
  };
  vm.runInNewContext(source, {
    ...scope,
    self: scope,
    caches: scope.caches,
    fetch: scope.fetch,
    URL,
    Request,
    Response,
    Promise,
    Set,
    Array,
    Map,
  });
  const respond = async (
    url: string,
    init: { method?: string; mode?: string } = {},
  ) => {
    let answered: Promise<Response> | undefined;
    const request = {
      url: `https://app.example${url}`,
      method: init.method ?? "GET",
      mode: init.mode ?? "no-cors",
    };
    (listeners.fetch as Listener)({
      request,
      respondWith: (promise: Promise<Response>) => (answered = promise),
    });
    return answered;
  };
  const run = async (type: string) => {
    let work: Promise<unknown> | undefined;
    (listeners[type] as Listener)({
      waitUntil: (promise: Promise<unknown>) => (work = promise),
    });
    await work;
  };
  return { respond, run, stores, fetched };
}

const html = (
  body = '<script type="module" src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index-abc.css">',
) =>
  new Response(`<!doctype html>${body}`, {
    headers: { "content-type": "text/html" },
  });

describe("service worker (ADR 0041)", () => {
  it("never answers anything under /api, non-GET requests or the worker file", async () => {
    const worker = makeWorker();
    expect(
      await worker.respond("/api/v1/ledgers", { mode: "cors" }),
    ).toBeUndefined();
    expect(await worker.respond("/api/health")).toBeUndefined();
    expect(await worker.respond("/api")).toBeUndefined();
    expect(
      await worker.respond("/transactions", {
        method: "POST",
        mode: "navigate",
      }),
    ).toBeUndefined();
    expect(await worker.respond("/sw.js")).toBeUndefined();
    expect(await worker.respond("/manifest.webmanifest")).toBeUndefined();
    expect(worker.fetched).toEqual([]);
  });

  it("keeps the shell, its hashed files and their fonts when installed", async () => {
    const worker = makeWorker({
      network: (url) =>
        url === "/"
          ? html()
          : url === "/assets/index-abc.css"
            ? new Response("@font-face{src:url(/assets/inter-1.woff2)}", {
                headers: { "content-type": "text/css" },
              })
            : new Response("x"),
    });
    await worker.run("install");
    const cache = worker.stores.get("ledgerline-v-test") as Map<
      string,
      Response
    >;
    expect([...cache.keys()].sort()).toEqual([
      "/",
      "/assets/index-abc.css",
      "/assets/index-abc.js",
      "/assets/inter-1.woff2",
    ]);
  });

  // What Vite writes for fonts.css: minified, no quotes in url(), and a unicode-range on every face.
  const face = (name: string, range?: string) =>
    `@font-face{font-family:Inter;font-style:normal;font-display:swap;font-weight:400;src:url(/assets/${name}.woff2)format("woff2"),url(/assets/${name}.woff)format("woff");${range ? `unicode-range:${range};` : ""}}`;
  const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+20AC";
  async function installedWith(css: string) {
    const worker = makeWorker({
      network: (url) =>
        url === "/"
          ? html()
          : url === "/assets/index-abc.css"
            ? new Response(css, { headers: { "content-type": "text/css" } })
            : new Response("x"),
    });
    await worker.run("install");
    const cache = worker.stores.get("ledgerline-v-test") as Map<
      string,
      Response
    >;
    return { cache: [...cache.keys()].sort(), fetched: worker.fetched };
  }

  it("keeps only the woff2 file of the font faces that cover Latin text, not the other scripts or the old format", async () => {
    const { cache, fetched } = await installedWith(
      [
        face("inter-cyrillic-400", "U+0301,U+0400-045F"),
        face("inter-greek-400", "U+0370-0377,U+03A3-03FF"),
        face("inter-latin-ext-400", "U+0100-02BA,U+20A0-20AB"),
        face("inter-latin-400", LATIN),
      ].join(""),
    );
    expect(cache).toEqual([
      "/",
      "/assets/index-abc.css",
      "/assets/index-abc.js",
      "/assets/inter-latin-400.woff2",
    ]);
    // Not downloaded at all, so a release costs the Latin files only.
    expect(
      fetched.filter((url) => /\.woff$|cyrillic|greek|latin-ext/.test(url)),
    ).toEqual([]);
  });

  it("reads the range the CSS minifier writes: U+?? is U+0000-00FF", async () => {
    // The real build rewrites the Latin face's range this way (checked on a build), and the Latin extended one stays.
    const { cache } = await installedWith(
      face("inter-latin-ext-500", "U+100-2BA,U+2BD-2C5,U+20A0-20AB") +
        face(
          "inter-latin-500",
          "U+??,U+131,U+152-153,U+2BB-2BC,U+2000-206F,U+20AC",
        ),
    );
    expect(cache).toContain("/assets/inter-latin-500.woff2");
    expect(cache).not.toContain("/assets/inter-latin-ext-500.woff2");
  });

  it("keeps a face only when its range reaches the letters: one that ends before them, or sits after, is left to the browser", async () => {
    const { cache } = await installedWith(
      face("inter-digits-400", "U+0020-0040") +
        face("inter-wild-400", "U+7?") +
        face("inter-wide-400", "U+0020-0040,U+6?"),
    );
    expect(cache).toContain("/assets/inter-wide-400.woff2");
    expect(cache).not.toContain("/assets/inter-digits-400.woff2");
    expect(cache).not.toContain("/assets/inter-wild-400.woff2");
  });

  it("reads a face written over several lines with quotes, and one with no range at all", async () => {
    const { cache } = await installedWith(
      `@font-face {\n  font-family: 'Inter';\n  src: url("/assets/plain.woff2") format('woff2'), url("/assets/plain.woff") format('woff');\n}\n` +
        face("inter-vietnamese-400", "U+0102-0103,U+1EA0-1EF9"),
    );
    expect(cache).toContain("/assets/plain.woff2");
    expect(cache).not.toContain("/assets/plain.woff");
    expect(cache).not.toContain("/assets/inter-vietnamese-400.woff2");
  });

  it("loads pages from the network and falls back to the shell only when it fails", async () => {
    let online = true;
    const worker = makeWorker({
      network: (url) => {
        if (!online) throw new TypeError("offline");
        return url === "/transactions" ? html("<p>fresh</p>") : html();
      },
    });
    const live = await (
      await worker.respond("/transactions", { mode: "navigate" })
    )?.text();
    expect(live).toContain("fresh");
    online = false;
    const offline = await (
      await worker.respond("/budgets", { mode: "navigate" })
    )?.text();
    expect(offline).toContain("fresh");
  });

  it("serves hashed files from the cache first", async () => {
    let calls = 0;
    const worker = makeWorker({
      network: () => {
        calls += 1;
        // A same-origin response is "basic" in a browser; a hand-made Response is not, so say so.
        return Object.defineProperty(new Response("body"), "type", {
          value: "basic",
        });
      },
    });
    await worker.respond("/assets/app-1.js");
    await worker.respond("/assets/app-1.js");
    expect(calls).toBe(1);
  });

  it("deletes other releases' caches when it takes over, and only ledgerline ones", async () => {
    const worker = makeWorker();
    worker.stores.set("ledgerline-v-old", new Map());
    worker.stores.set("something-else", new Map());
    await worker.run("activate");
    expect([...worker.stores.keys()].sort()).toEqual(["something-else"]);
  });
});
