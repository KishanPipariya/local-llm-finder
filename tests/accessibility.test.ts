import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type BrowserContext, type Page } from "playwright";

const port = 3199;
const origin = `http://127.0.0.1:${port}`;

async function waitForPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { await page.goto(origin, { waitUntil: "networkidle", timeout: 1_000 }); return page; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error("The local Next.js server did not start.");
}

async function assertNoAxeViolations(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(results.violations, [], `axe violations on ${state}: ${results.violations.map((v) => `${v.id}: ${v.help}`).join("; ")}`);
}

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)], { stdio: "ignore" });
server.unref();
process.once("exit", () => server.kill("SIGTERM"));
const browser = await chromium.launch();
const context = await browser.newContext();

try {
  const initial = await waitForPage(context);
  await assertNoAxeViolations(initial, "initial finder");
  await initial.keyboard.press("Tab");
  assert.equal(await initial.locator(":focus").textContent(), "Skip to the model finder");
  const button = initial.getByRole("button", { name: "Find compatible models" });
  const buttonBox = await button.boundingBox();
  assert.ok(buttonBox && buttonBox.width >= 44 && buttonBox.height >= 44, "submit target is at least 44 by 44 CSS pixels");

  const narrowContext = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const invalid = await narrowContext.newPage();
  await invalid.goto(`${origin}/?chip=m4Pro&memoryGb=16&diskGb=0&workload=nope`, { waitUntil: "networkidle" });
  await assertNoAxeViolations(invalid, "server-rendered invalid form");
  assert.equal(await invalid.locator(":focus").getAttribute("class"), "error-summary");
  assert.equal(await invalid.locator("#memoryGb").getAttribute("aria-invalid"), "true");
  assert.equal(await invalid.locator("#memoryGb").getAttribute("aria-describedby"), "memory-error");
  assert.equal(await invalid.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "320px viewport reflows without horizontal scrolling");

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  const noScript = await noScriptContext.newPage();
  await noScript.goto(origin, { waitUntil: "domcontentloaded" });
  await noScript.locator("#diskGb").fill("12");
  await noScript.getByRole("button", { name: "Find compatible models" }).click();
  await noScript.waitForURL(/diskGb=12/);
  assert.match(noScript.url(), /chip=m4/);
  assert.ok(await noScript.locator("#results").count(), "server-rendered results are visible without JavaScript");
  await noScriptContext.close();
  await narrowContext.close();
  await context.close();
} finally {
  await browser.close();
}
