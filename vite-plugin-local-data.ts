import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

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
