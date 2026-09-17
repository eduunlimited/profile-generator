import type { Browser } from "playwright-core";

const EMPTY = { status: 0, text: "" };

async function launchBrowser(): Promise<Browser | null> {
  try {
    const { chromium } = await import("playwright-core");
    for (const channel of ["chrome", "msedge"] as const) {
      try {
        return await chromium.launch({
          channel,
          headless: true,
          args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
        });
      } catch {
        // Try the next installed browser.
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function crawlSeventeenTrack(tracking: string, carrierFc?: string): Promise<{ status: number; text: string }> {
  const ids = tracking
    .split(/[,\s]+/)
    .map((value) => value.replace(/[\s-]/g, "").toUpperCase())
    .filter((id, index, all) => id.length >= 8 && all.indexOf(id) === index);
  if (ids.length === 0) return EMPTY;

  const browser = await launchBrowser();
  if (!browser) return EMPTY;

  try {
    const page = await browser.newPage({
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    });
    const bodies: string[] = [];
    const gotBody = new Promise<void>((resolve) => {
      page.on("response", (response) => {
        if (!/\/track\/restapi|\/restapi\/track/i.test(response.url()) || response.status() !== 200) return;
        void response
          .text()
          .then((text) => {
            if (text && !text.includes('"code":-14')) {
              bodies.push(text);
              resolve();
            }
          })
          .catch(() => undefined);
      });
    });

    const fc = carrierFc?.trim() ? `&fc=${encodeURIComponent(carrierFc.trim())}` : "";
    await page.goto(`https://t.17track.net/en#nums=${ids.map((id) => encodeURIComponent(id)).join(",")}${fc}`, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    await Promise.race([gotBody, new Promise((resolve) => setTimeout(resolve, 12000))]);
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    await page.close();
    return {
      status: 200,
      text: [bodies.join("\n"), text].filter(Boolean).join("\n").slice(0, 250_000),
    };
  } catch {
    return EMPTY;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
