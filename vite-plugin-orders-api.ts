import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { Plugin } from "vite";
import {
  ORDERS_API_PORT,
  exportOrdersPayload,
  parseOrdersApiQuery,
  type OrdersApiExport,
} from "./src/lib/ordersApi";

function readObject(filePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or unreadable stores export as empty.
  }
  return {};
}

function tokenMatches(presented: string, expected: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function bearerToken(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value ?? "");
  return match?.[1] ?? "";
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: OrdersApiExport | { error: string },
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

export function ordersApiPlugin(): Plugin {
  return {
    name: "orders-api",
    configureServer(server) {
      const dataDir = path.resolve(process.cwd(), "data");
      const listener = http.createServer((req, res) => {
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Private-Network": "true",
            "Content-Length": "0",
          });
          res.end();
          return;
        }
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (req.method !== "GET" || url.pathname !== "/api/orders") {
          sendJson(res, 404, { error: "Not found." });
          return;
        }
        const settings = readObject(path.join(dataDir, "orders-api.json"));
        const enabled = settings.enabled === true || settings.enabled === "true";
        const token = typeof settings.token === "string" ? settings.token.trim() : "";
        if (!enabled || !token) {
          sendJson(res, 404, { error: "Orders API is disabled." });
          return;
        }
        if (!tokenMatches(bearerToken(req.headers.authorization), token)) {
          sendJson(res, 401, { error: "Missing or invalid API token." });
          return;
        }
        const parsed = parseOrdersApiQuery(url.searchParams);
        if ("error" in parsed) {
          sendJson(res, 400, { error: parsed.error });
          return;
        }
        const result = exportOrdersPayload(
          readObject(path.join(dataDir, "orders.json")),
          readObject(path.join(dataDir, "dismissed-orders.json")),
          parsed.query,
        );
        if ("error" in result) {
          sendJson(res, result.status, { error: result.error });
          return;
        }
        sendJson(res, 200, result);
      });
      listener.listen(ORDERS_API_PORT, "127.0.0.1", () => {
        server.config.logger.info(`Orders API http://127.0.0.1:${ORDERS_API_PORT}/api/orders`);
      });
      listener.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          server.config.logger.warn(`Orders API port ${ORDERS_API_PORT} is already in use.`);
          return;
        }
        server.config.logger.error(`Orders API failed to start: ${error.message}`);
      });
      server.httpServer?.on("close", () => listener.close());
    },
  };
}
