import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type BrowserContext, type Page } from "playwright";
import { chipProfiles } from "../lib/recommendations.js";

async function allocatePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local test port.");
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

const port = await allocatePort();
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

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port)], { stdio: "ignore", env: { ...process.env, MAC_LLM_BROWSER_TEST_FIXTURE: "1" } });
const browser = await chromium.launch();
const context = await browser.newContext();

try {
  const initial = await waitForPage(context);
  await assertNoAxeViolations(initial, "initial finder");
  const lightSurface = await initial.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
  await initial.keyboard.press("Tab");
  assert.equal(await initial.locator(":focus").textContent(), "Skip to the model finder");
  const button = initial.getByRole("button", { name: "Find compatible models" });
  const buttonBox = await button.boundingBox();
  assert.ok(buttonBox && buttonBox.width >= 44 && buttonBox.height >= 44, "submit target is at least 44 by 44 CSS pixels");

  await initial.waitForFunction(() => document.querySelectorAll("#memoryGb option").length === 3);
  for (const [chip, profile] of Object.entries(chipProfiles)) {
    await initial.locator("#chip").selectOption(chip);
    assert.deepEqual(await initial.locator("#memoryGb option").evaluateAll((options) => options.map((option) => option.getAttribute("value"))), profile.memoryOptionsGb.map(String), `${profile.name} exposes only its supported memory options`);
  }

  await initial.locator("#chip").selectOption("m4");
  await initial.locator("#memoryGb").selectOption("16");
  await initial.locator("#chip").selectOption("m4Pro");
  assert.equal(await initial.locator("#memoryGb").inputValue(), "24");
  await assertNoAxeViolations(initial, "chip-adjusted finder");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await initial.locator("[aria-live=polite]").textContent(), "Unified memory adjusted to 24 GB for M4 Pro.");

  await initial.locator("#chip").selectOption("m4");
  await initial.locator("#memoryGb").selectOption("24");
  await initial.locator("#chip").selectOption("m1Pro");
  assert.equal(await initial.locator("#memoryGb").inputValue(), "16", "equal-distance choices prefer lower memory");

  await initial.locator("#chip").selectOption("m4Pro");
  await initial.locator("#memoryGb").selectOption("48");
  await initial.locator("#chip").selectOption("m5Pro");
  assert.equal(await initial.locator("#memoryGb").inputValue(), "48", "shared memory remains selected");

  const narrowContext = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const invalid = await narrowContext.newPage();
  await invalid.goto(`${origin}/?chip=m4Pro&memoryGb=16&diskGb=0&workload=nope`, { waitUntil: "networkidle" });
  await assertNoAxeViolations(invalid, "server-rendered invalid form");
  assert.equal(await invalid.locator(":focus").getAttribute("class"), "error-summary");
  assert.equal(await invalid.locator("#memoryGb").getAttribute("aria-invalid"), "true");
  assert.equal(await invalid.locator("#memoryGb").getAttribute("aria-describedby"), "memory-error");
  assert.equal(await invalid.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "320px viewport reflows without horizontal scrolling");

  const partial = await narrowContext.newPage();
  await partial.goto(`${origin}/?chip=m4`, { waitUntil: "networkidle" });
  assert.deepEqual(await partial.locator(".field-error").allTextContents(), ["Choose a memory configuration supported by that chip.", "Free disk space must be between 1 and 4,000 GB.", "Choose a workload."], "partial GET uses the same required fields as the API");

  const darkContext = await browser.newContext({ colorScheme: "dark" });
  const dark = await waitForPage(darkContext);
  await assertNoAxeViolations(dark, "dark-theme finder");
  assert.notEqual(await dark.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor), lightSurface, "dark theme uses a distinct page surface");
  await dark.keyboard.press("Tab");
  assert.notEqual(await dark.locator(":focus").evaluate((element) => getComputedStyle(element).outlineStyle), "none", "dark theme keeps a visible keyboard focus treatment");

  const narrowDarkContext = await browser.newContext({ colorScheme: "dark", viewport: { width: 320, height: 720 } });
  const darkInvalid = await narrowDarkContext.newPage();
  await darkInvalid.goto(`${origin}/?chip=m4Pro&memoryGb=16&diskGb=0&workload=nope`, { waitUntil: "networkidle" });
  await assertNoAxeViolations(darkInvalid, "dark-theme server-rendered invalid form");
  assert.equal(await darkInvalid.locator(".error-summary").count(), 1, "dark theme retains the visible error summary");
  assert.equal(await darkInvalid.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "dark theme reflows without horizontal scrolling at 320px");

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  const noScript = await noScriptContext.newPage();
  await noScript.goto(origin, { waitUntil: "domcontentloaded" });
  await noScript.locator("#chip").selectOption("m4");
  await noScript.locator("#memoryGb").selectOption("16");
  await noScript.locator("#diskGb").fill("12");
  await noScript.getByRole("button", { name: "Find compatible models" }).click({ force: true, noWaitAfter: true });
  await noScript.waitForURL(/memoryGb=16/);
  assert.match(noScript.url(), /chip=m4/);
  assert.equal(await noScript.locator(".error-summary").count(), 0);
  assert.equal(await noScript.locator("#results").count(), 1, "fixture-backed recommendations render server-side without JavaScript");
  assert.ok(await noScript.locator(".card").count());
  await noScriptContext.close();
  await narrowDarkContext.close();
  await darkContext.close();
  await narrowContext.close();
  await context.close();
} finally {
  await browser.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
}
