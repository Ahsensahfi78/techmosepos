import fs from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

function resolveBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const CHROME = resolveBrowser();
if (!CHROME) {
  console.error("No Chrome/Edge found. Tried:\n  " + CHROME_CANDIDATES.join("\n  "));
  process.exit(2);
}
console.log(`browser = ${CHROME}`);

const BASE = process.env.APP_URL || "http://localhost:3000";
const results = [];
const ok = (name, pass, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type('input[placeholder="Enter username"]', "admin");
  await page.type('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  await page
    .waitForFunction(() => !location.pathname.startsWith("/login"), {
      timeout: 45000,
    })
    .catch(() => {});
  ok("login", !page.url().includes("/login"), page.url());

  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
  await page.waitForFunction(
    () => document.body.innerText.includes("Receipt / Invoice Details"),
    { timeout: 60000 }
  );
  ok("settings shows Receipt / Invoice Details", true);

  const hasWidthOptions = await page.evaluate(() => {
    const sel = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "58")
    );
    if (!sel) return false;
    const values = [...sel.options].map((o) => Number(o.value));
    return values.includes(58) && values.includes(80) && values.length === 23;
  });
  ok("paper width select offers 58-80mm", hasWidthOptions);

  const pageRule = await page.evaluate(() => {
    const el = document.getElementById("receipt-page-style");
    return el ? el.textContent : null;
  });
  ok(
    "runtime @page style injected (two lengths, never `auto`)",
    !!pageRule &&
      /@page\s*\{\s*size:\s*80mm\s+\d+mm\s*;/.test(pageRule) &&
      !pageRule.includes("auto"),
    String(pageRule)
  );

  const rootW = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--receipt-width")
  );
  ok("--receipt-width applied", rootW === "80mm", rootW);

  const previewText = await page.evaluate(() => {
    const el = document.querySelector(".receipt-preview .receipt");
    return el ? el.innerText : null;
  });
  ok(
    "live preview rendered",
    !!previewText,
    previewText ? `${previewText.length} chars` : "missing"
  );

  const banned = [
    "TechMOS",
    "Mobile Shop POS System",
    "Developed by Techmos",
    "Techmos POS Mobile System",
  ];
  const found = banned.filter((b) => (previewText || "").includes(b));
  ok("preview has no hardcoded branding", found.length === 0, found.join(", "));

  const hasShopInput = await page.evaluate(() => {
    const label = [...document.querySelectorAll("label")].find(
      (l) => l.textContent.trim() === "Shop name"
    );
    return !!(label && label.parentElement.querySelector("input"));
  });
  ok("shop name field present", hasShopInput);

  if (hasShopInput) {
    await page.evaluate(() => {
      const label = [...document.querySelectorAll("label")].find(
        (l) => l.textContent.trim() === "Shop name"
      );
      const input = label.parentElement.querySelector("input");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const shopHandle = await page.evaluateHandle(() => {
      const label = [...document.querySelectorAll("label")].find(
        (l) => l.textContent.trim() === "Shop name"
      );
      return label.parentElement.querySelector("input");
    });
    await shopHandle.focus();
    await shopHandle.type("Kalmunai Mobile Centre");
    await new Promise((r) => setTimeout(r, 300));

    const title = await page.evaluate(() => {
      const t = document.querySelector(".receipt-preview .receipt .r-title");
      return t ? t.textContent : null;
    });
    ok(
      "preview updates live as you type",
      String(title).includes("Kalmunai Mobile Centre"),
      String(title)
    );

    // Empty the optional fields and confirm no blank lines are left behind.
    await page.evaluate(() => {
      const set = (selector, value) => {
        const label = [...document.querySelectorAll("label")].find(
          (l) => l.textContent.trim() === selector
        );
        const field = label && label.parentElement.querySelector("textarea, input");
        if (!field) return;
        const proto = field.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("Address", "");
      set("Phone number(s)", "");
      set("Email / website", "");
      set("Footer message", "");
    });
    await new Promise((r) => setTimeout(r, 300));

    const state = await page.evaluate(() => {
      const el = document.querySelector(".receipt-preview .receipt");
      if (!el) return null;
      return {
        hasFooter: !!el.querySelector(".r-foot"),
        subLines: el.querySelectorAll(".r-head .r-sub").length,
        height: Math.round(el.getBoundingClientRect().height),
      };
    });
    ok(
      "blank footer leaves no footer block",
      !!state && state.hasFooter === false,
      JSON.stringify(state)
    );
    ok(
      "blank address/phone/email leave no gaps",
      !!state && state.subLines === 0,
      JSON.stringify(state)
    );
  }

  // Discard everything typed above — nothing was saved.
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
} catch (err) {
  ok("script completed", false, String((err && err.message) || err));
} finally {
  await browser.close();
}

const output = results.join("\n");
console.log(output);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
fs.writeFileSync(
  "C:\\Users\\SAHFI\\AppData\\Local\\Temp\\opencode\\receipt-smoke.txt",
  output
);
process.exit(failed ? 1 : 0);
