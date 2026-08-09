import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type BrowserContext, type Page } from "playwright";
import { chipProfiles, chips, validateConfig } from "../lib/recommendations.js";

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

async function assertUnchangedBox(page: Page, selector: string, action: () => Promise<void>, description: string) {
  const target = page.locator(selector);
  const getDocumentBox = () => target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height };
  });
  const before = await getDocumentBox();
  assert.ok(before, `${description} has a layout box before interaction`);
  await action();
  await page.waitForTimeout(250);
  assert.deepEqual(await getDocumentBox(), before, `${description} does not move or resize`);
}

async function assertCardDisclosure(page: Page, name: string) {
  const disclosure = page.locator(".card").first().locator("details").filter({ has: page.getByText(name, { exact: true }) });
  const summary = disclosure.locator("summary");
  const content = disclosure.locator(".disclosure-content");

  assert.equal(await disclosure.getAttribute("open"), null, `${name} starts collapsed`);
  const summaryBox = await summary.boundingBox();
  assert.ok(summaryBox && summaryBox.width >= 44 && summaryBox.height >= 44, `${name} summary is at least 44 by 44 CSS pixels`);

  await summary.click();
  assert.notEqual(await disclosure.getAttribute("open"), null, `${name} opens by mouse`);
  assert.equal(await content.isVisible(), true, `${name} content is visible when open`);
  await summary.click();
  assert.equal(await disclosure.getAttribute("open"), null, `${name} closes by mouse`);

  await summary.focus();
  await page.keyboard.press("Space");
  assert.notEqual(await disclosure.getAttribute("open"), null, `${name} opens by keyboard`);
  await page.keyboard.press("Enter");
  assert.equal(await disclosure.getAttribute("open"), null, `${name} closes by keyboard`);
}

async function assertPhoneLayout(page: Page, state: string) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${state} reflows without horizontal scrolling`);
  const finder = await page.locator(".finder").boundingBox();
  assert.ok(finder && finder.width <= (await page.evaluate(() => window.innerWidth)), `${state} finder fits the viewport`);
  for (const selector of [".fields", ".context", ".cards"]) {
    const grid = page.locator(selector).first();
    if (await grid.count()) assert.equal(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 1, `${state} ${selector} uses one column`);
  }
}

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port)], { stdio: "ignore", env: { ...process.env, MAC_LLM_BROWSER_TEST_FIXTURE: "1" } });
const browser = await chromium.launch();
const context = await browser.newContext();

try {
  const initial = await waitForPage(context);
  await assertNoAxeViolations(initial, "initial finder");
  assert.equal(await initial.locator(".section-help").filter({ hasText: "We only show model files compatible with the selected runtime." }).count(), 1, "runtime helper explains selected-runtime compatibility");
  assert.deepEqual(await initial.locator('input[name="runtime"]').evaluateAll((inputs) => inputs.map((input) => input.getAttribute("value"))), ["llamaCpp", "mlx", "lmStudio", "ollama"], "runtime choices prioritize llama.cpp and MLX");
  assert.deepEqual(await initial.locator('input[name="context"]').evaluateAll((inputs) => inputs.map((input) => input.parentElement?.textContent?.trim())), ["Small · 4K tokensShort chats", "Normal · 16K tokensTypical chat or coding", "Long · 32K tokensLarge documents or repositories"], "context choices specify their numeric token capacities");
  assert.equal(await initial.locator('link[rel="canonical"]').getAttribute("href"), "https://local-llm-finder-m7qb.vercel.app", "canonical URL uses the public site URL");
  assert.equal(await initial.locator('meta[property="og:url"]').getAttribute("content"), "https://local-llm-finder-m7qb.vercel.app", "Open Graph metadata uses the public site URL");
  assert.equal(await initial.locator('meta[name="twitter:card"]').getAttribute("content"), "summary_large_image", "Twitter uses a large image card");
  assert.ok(await initial.locator('meta[property="og:image"]').count(), "Open Graph image metadata is present");
  assert.ok(await initial.locator('link[rel="icon"][href*="/icon"]').count(), "generated app icon metadata is present");
  const socialImage = await initial.request.get(`${origin}/opengraph-image`);
  assert.equal(socialImage.status(), 200, "generated social image responds successfully");
  assert.match(socialImage.headers()["content-type"] ?? "", /^image\/png/, "generated social image is a PNG");
  const presetLinks = initial.locator(".presets a");
  assert.equal(await presetLinks.count(), 3, "three quick-start preset links are available");
  for (let index = 0; index < await presetLinks.count(); index += 1) {
    const preset = presetLinks.nth(index);
    const href = await preset.getAttribute("href");
    assert.ok(href, "preset has a URL");
    const query = new URL(href, origin).searchParams;
    const config = { chip: query.get("chip") ?? undefined, memoryGb: Number(query.get("memoryGb")), diskGb: Number(query.get("diskGb")), workload: query.get("workload") ?? undefined, runtime: query.get("runtime") ?? undefined, context: query.get("context") ?? undefined };
    assert.equal(validateConfig(config).valid, true, `${await preset.textContent()} has a complete valid configuration URL`);
    await initial.goto(new URL(href, origin).toString(), { waitUntil: "networkidle" });
    assert.equal(await initial.locator("#results").count(), 1, `${await preset.textContent()} reaches a server-rendered shortlist`);
    await preset.focus().catch(() => undefined);
  }
  await initial.goto(origin, { waitUntil: "networkidle" });
  const firstPreset = initial.getByRole("link", { name: /Everyday/ });
  await firstPreset.focus();
  assert.equal(await initial.locator(":focus").evaluate((element) => element.tagName), "A", "preset retains keyboard-accessible link semantics");
  await initial.goto(origin, { waitUntil: "networkidle" });
  const lightSurface = await initial.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
  await initial.keyboard.press("Tab");
  assert.equal(await initial.locator(":focus").textContent(), "Skip to the model finder");
  const button = initial.getByRole("button", { name: "Find compatible models" });
  const buttonBox = await button.boundingBox();
  assert.ok(buttonBox && buttonBox.width >= 44 && buttonBox.height >= 44, "submit target is at least 44 by 44 CSS pixels");

  const allMemoryValues = [...new Set(chips.flatMap((chip) => chip.memoryOptionsGb))].sort((a, b) => a - b).map(String);
  assert.deepEqual(await initial.locator("#memoryGb option").evaluateAll((options) => options.map((option) => option.getAttribute("value"))), allMemoryValues, "initial memory list is comprehensive");
  await initial.waitForTimeout(250);
  assert.deepEqual(await initial.locator("#memoryGb option").evaluateAll((options) => options.map((option) => option.getAttribute("value"))), allMemoryValues, "hydration does not change the initial memory list");

  await assertUnchangedBox(initial, ".workload label:has(input[value=balanced]) span", () => initial.locator(".workload label:has(input[value=chat])").click(), "selecting a workload choice");
  await assertUnchangedBox(initial, ".workload label:has(input[value=chat]) span", () => initial.locator(".workload label:has(input[value=chat])").hover(), "hovering a workload choice");
  await assertUnchangedBox(initial, "button[type=submit]", () => button.hover(), "hovering the submit button");

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

  await initial.goto(`${origin}/?chip=m4&memoryGb=16&diskGb=12&workload=chat`, { waitUntil: "networkidle" });
  assert.equal(await initial.locator(".card.top-pick").count(), 1, "the first ranked result is visually marked as the top pick");
  assert.equal(await initial.locator(".card").first().locator(".top-pick-label").textContent(), "Top pick");
  assert.equal(await initial.getByRole("link", { name: "View llama3.2:3b on Ollama (opens in a new tab)" }).count(), 1, "native Ollama entries identify their registry source");
  await assertUnchangedBox(initial, ".card", () => initial.locator(".card").first().hover(), "hovering a recommendation card");
  await assertCardDisclosure(initial, "Installation guidance");
  await initial.locator(".card").first().getByText("Installation guidance", { exact: true }).click();
  assert.equal(await initial.locator(".card").first().locator(".guide code").textContent(), "ollama pull llama3.2:3b && ollama run llama3.2:3b", "server-rendered native installation guidance uses the verified pull target");
  await assertCardDisclosure(initial, "Technical details and ranking factors");
  await assertNoAxeViolations(initial, "recommendation-card disclosures");

  const narrowContext = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const narrowInitial = await waitForPage(narrowContext);
  await assertNoAxeViolations(narrowInitial, "320px initial finder");
  await assertPhoneLayout(narrowInitial, "320px initial finder");
  const invalid = await narrowContext.newPage();
  await invalid.goto(`${origin}/?chip=m4Pro&memoryGb=16&diskGb=0&workload=nope`, { waitUntil: "networkidle" });
  await assertNoAxeViolations(invalid, "server-rendered invalid form");
  assert.equal(await invalid.locator(":focus").getAttribute("class"), "error-summary");
  assert.equal(await invalid.locator("#memoryGb").getAttribute("aria-invalid"), "true");
  assert.equal(await invalid.locator("#memoryGb").getAttribute("aria-describedby"), "memory-error");
  await assertPhoneLayout(invalid, "320px invalid finder");

  const narrowResults = await narrowContext.newPage();
  await narrowResults.goto(`${origin}/?chip=m4&memoryGb=16&diskGb=12&workload=chat`, { waitUntil: "networkidle" });
  await assertNoAxeViolations(narrowResults, "320px populated results");
  await assertPhoneLayout(narrowResults, "320px populated results");
  assert.equal(await narrowResults.locator(".cards").count(), 1, "320px populated results retain recommendation cards");

  const partial = await narrowContext.newPage();
  await partial.goto(`${origin}/?chip=m4`, { waitUntil: "networkidle" });
  assert.deepEqual(await partial.locator(".field-error").allTextContents(), ["Choose a memory configuration supported by that chip.", "Free disk space must be between 1 and 4,000 GB.", "Choose a workload."], "partial GET uses the same required fields as the API");

  const phoneContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const phoneInitial = await waitForPage(phoneContext);
  await assertNoAxeViolations(phoneInitial, "375px initial finder");
  await assertPhoneLayout(phoneInitial, "375px initial finder");
  const phoneInvalid = await phoneContext.newPage();
  await phoneInvalid.goto(`${origin}/?chip=m4Pro&memoryGb=16&diskGb=0&workload=nope`, { waitUntil: "networkidle" });
  await assertNoAxeViolations(phoneInvalid, "375px invalid finder");
  await assertPhoneLayout(phoneInvalid, "375px invalid finder");
  const phoneResults = await phoneContext.newPage();
  await phoneResults.goto(`${origin}/?chip=m4&memoryGb=16&diskGb=12&workload=chat`, { waitUntil: "networkidle" });
  await assertNoAxeViolations(phoneResults, "375px populated results");
  await assertPhoneLayout(phoneResults, "375px populated results");

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
  await assertCardDisclosure(noScript, "Installation guidance");
  await assertCardDisclosure(noScript, "Technical details and ranking factors");
  await noScriptContext.close();
  await phoneContext.close();
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
