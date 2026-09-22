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

function ready(text: string): boolean {
  return (
    /estimated\s+to\s+arrive/i.test(text) ||
    /"(?:displayEstDeliveryDt|estDeliveryDt|scheduledDeliveryDate|scheduledDeliveryDay|edtDate)"\s*:\s*"[^"]+"/i.test(
      text,
    ) ||
    /delivered(?:\s+on)?[:\s]/i.test(text)
  );
}

export async function crawlUpsTrack(tracking: string): Promise<{ status: number; text: string }> {
  const id = tracking.replace(/[\s-]/g, "").toUpperCase();
  if (id.length < 8 || id === "—") return EMPTY;

  const browser = await launchBrowser();
  if (!browser) return EMPTY;

  try {
    const page = await browser.newPage({
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    });
    const bodies: string[] = [];
    const gotEta = new Promise<void>((resolve) => {
      page.on("response", (response) => {
        if (!/\/track\/api\/Track\/GetStatus/i.test(response.url()) || response.status() !== 200) return;
        void response
          .text()
          .then((text) => {
            if (!text || text.length < 40) return;
            bodies.push(text);
            if (ready(text)) resolve();
          })
          .catch(() => undefined);
      });
    });

    await page.goto(`https://www.ups.com/track?tracknum=${encodeURIComponent(id)}&loc=en_US`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const gotPage = (async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const visible = await page.evaluate(() => document.body?.innerText ?? "");
        if (ready(visible)) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    })();
    await Promise.race([gotEta, gotPage, new Promise((resolve) => setTimeout(resolve, 14000))]);
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    await page.close();
    return {
      status: 200,
      text: [`TRACK: ${id}`, bodies.join("\n"), text].filter(Boolean).join("\n").slice(0, 250_000),
    };
  } catch {
    return EMPTY;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
