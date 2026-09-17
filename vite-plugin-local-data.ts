import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { crawlSeventeenTrack } from "./vite-17track-crawl";

const DATA_ROUTE = "/__data";

function safeFileName(name: string): string | null {
  const base = path.basename(name);
  if (!base.endsWith(".json") || base.includes("..")) {
    return null;
  }
  return base;
}

function pruneBackups(backupDir: string, fileName: string, keep = 20) {
  if (!fs.existsSync(backupDir)) return;
  const prefix = `${fileName}.`;
  const backups = fs
    .readdirSync(backupDir)
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => ({
      entry,
      mtime: fs.statSync(path.join(backupDir, entry)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const stale of backups.slice(keep)) {
    fs.unlinkSync(path.join(backupDir, stale.entry));
  }
}

export function localDataPlugin(): Plugin {
  const dataDir = path.resolve(process.cwd(), "data");
  const backupDir = path.join(dataDir, "backups");

  return {
    name: "local-data",
    configureServer(server) {
      server.middlewares.use("/__track", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          void (async () => {
            try {
              const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                url?: string;
                method?: string;
                json?: unknown;
              };
              const target = new URL(payload.url ?? "");
              const host = target.hostname.toLowerCase();
              const allowed =
                host === "www.fedex.com" ||
                host === "www.ups.com" ||
                host === "webapis.ups.com" ||
                host === "wwwapps.ups.com" ||
                host === "tools.usps.com" ||
                host === "www.usps.com" ||
                host === "t.17track.net" ||
                host === "www.17track.net";
              if (!allowed) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ status: 0, text: "" }));
                return;
              }
              const tracking =
                target.hash.match(/nums=([^&]+)/i)?.[1] ??
                target.searchParams.get("nums") ??
                (payload.json && typeof payload.json === "object"
                  ? String(
                      (payload.json as { data?: Array<{ num?: string }> }).data?.[0]?.num ?? "",
                    )
                  : "");
              const carrierFc = target.hash.match(/[?&]fc=([^&]+)/i)?.[1] ?? target.searchParams.get("fc") ?? undefined;
              if (host.endsWith("17track.net") && tracking) {
                const crawled = await crawlSeventeenTrack(decodeURIComponent(tracking), carrierFc ?? undefined);
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Cache-Control", "no-store");
                res.end(JSON.stringify(crawled));
                return;
              }
              const response = await fetch(target.toString(), {
                method: payload.method === "POST" ? "POST" : "GET",
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                  "Accept-Language": "en-US,en;q=0.9",
                  ...(payload.json != null ? { "Content-Type": "application/json" } : {}),
                },
                body: payload.json != null ? JSON.stringify(payload.json) : undefined,
                redirect: "follow",
                signal: AbortSignal.timeout(15000),
              });
              const text = (await response.text()).slice(0, 250_000);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Cache-Control", "no-store");
              res.end(JSON.stringify({ status: response.status, text }));
            } catch {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ status: 0, text: "" }));
            }
          })();
        });
      });

      server.middlewares.use("/__geocode", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          void (async () => {
            try {
              const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                apiKey?: string;
                street?: string;
                unit?: string;
                city?: string;
                state?: string;
                postalCode?: string;
              };
              const params = new URLSearchParams({
                api_key: payload.apiKey?.trim() ?? "",
                street: payload.street?.trim() ?? "",
                city: payload.city?.trim() ?? "",
                state_province: payload.state?.trim() ?? "",
                postal_code: payload.postalCode?.trim() ?? "",
                country: "US",
                fields: "zip4",
                limit: "1",
              });
              const unit = payload.unit?.trim() ?? "";
              if (unit) params.set("street2", unit);
              const response = await fetch(`https://api.geocod.io/v2/geocode?${params.toString()}`);
              const text = await response.text();
              res.statusCode = response.ok ? 200 : response.status;
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Cache-Control", "no-store");
              res.end(text);
            } catch {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Geocodio proxy failed." }));
            }
          })();
        });
      });

      server.middlewares.use(DATA_ROUTE, (req, res, next) => {
        const urlPath = (req.url ?? "").split("?")[0] ?? "";
        const fileName = safeFileName(urlPath.replace(/^\//, ""));
        if (!fileName) {
          res.statusCode = 400;
          res.end("Invalid data file.");
          return;
        }

        const filePath = path.join(dataDir, fileName);
        fs.mkdirSync(dataDir, { recursive: true });

        if (req.method === "GET") {
          res.setHeader("Cache-Control", "no-store");
          if (!fs.existsSync(filePath)) {
            res.setHeader("Content-Type", "application/json");
            res.end("{}");
            return;
          }
          res.setHeader("Content-Type", "application/json");
          fs.createReadStream(filePath).pipe(res);
          return;
        }

        if (req.method === "PUT") {
          res.setHeader("Cache-Control", "no-store");
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => {
            try {
              const body = Buffer.concat(chunks).toString("utf8");
              JSON.parse(body);
              fs.mkdirSync(backupDir, { recursive: true });
              if (fs.existsSync(filePath)) {
                const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                fs.copyFileSync(filePath, path.join(backupDir, `${fileName}.${stamp}.json`));
                pruneBackups(backupDir, fileName);
              }
              fs.writeFileSync(filePath, body, "utf8");
              res.statusCode = 204;
              res.end();
            } catch {
              res.statusCode = 400;
              res.end("Invalid JSON payload.");
            }
          });
          return;
        }

        next();
      });
    },
  };
}
