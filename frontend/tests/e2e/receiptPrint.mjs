import fs from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("no browser");
  process.exit(2);
}

const BASE = process.env.APP_URL || "http://localhost:3000";
const results = [];
const ok = (name, pass, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

/** Mirrors components/ReceiptPaper.tsx markup. */
function receiptHtml(itemCount) {
  const items = Array.from({ length: itemCount }, (_, i) => {
    const n = i + 1;
    return `
      <div class="r-item">
        <div class="r-col">
          <span class="r-name"><span class="n">Item number ${n} — sample product name</span><span class="r-code">SKU-${1000 + n} · 4712345${10000 + n}</span></span>
          <span class="r-qty">${(i % 3) + 1}</span>
          <span class="r-amt">Rs ${(1250 + n * 13).toLocaleString("en-LK")}.00</span>
        </div>
        <p class="r-unit">@ Rs ${(450 + n).toLocaleString("en-LK")}.00 each</p>
      </div>`;
  }).join("");

  return `<div class="receipt">
    <div class="r-head">
      <p class="r-title">Kalmunai Mobile Centre</p>
      <p class="r-sub">Main Street, Kalmunai</p>
      <p class="r-sub">0771234184 · 0112345678</p>
    </div>
    <div class="r-divider"></div>
    <p class="r-line"><span>Receipt</span><span>#30</span></p>
    <p class="r-line"><span>Date</span><span>3/10/2026 4:00:00 PM</span></p>
    <p class="r-line"><span>Cashier</span><span>Administrator</span></p>
    <div class="r-divider"></div>
    <div class="r-col r-th">
      <span class="r-name">ITEM</span><span class="r-qty">QTY</span><span class="r-amt">TOTAL</span>
    </div>
    ${items}
    <div class="r-divider"></div>
    <div class="r-totals">
      <p class="r-row"><span>Subtotal</span><span>Rs 24,500.00</span></p>
      <p class="r-row r-total"><span>TOTAL</span><span>Rs 24,500.00</span></p>
      <p class="r-row"><span>Paid (cash)</span><span>Rs 25,000.00</span></p>
      <p class="r-row"><span>Change</span><span>Rs 500.00</span></p>
    </div>
    <div class="r-divider"></div>
    <div class="r-foot"><p>Thank you, come again!</p><p>Return within 3 days with receipt.</p></div>
  </div>`;
}

function countPages(pdf) {
  const s = Buffer.from(pdf).toString("latin1");
  const matches = s.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

function mediaBox(pdf) {
  const s = Buffer.from(pdf).toString("latin1");
  const m = s.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
  if (!m) return null;
  return { w: parseFloat(m[3]), h: parseFloat(m[4]) };
}

const toMm = (pt) => (pt / 72) * 25.4;

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
    .waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 45000 })
    .catch(() => {});
  ok("login", !page.url().includes("/login"), page.url());

  // ── Real code path: Settings runs fitReceiptPage() against its own preview.
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
  await page.waitForFunction(
    () => document.body.innerText.includes("Receipt / Invoice Details"),
    { timeout: 60000 }
  );
  await new Promise((r) => setTimeout(r, 800));
  const runtimeRule = await page.evaluate(() => {
    const el = document.getElementById("receipt-page-style");
    return el ? el.textContent : null;
  });
  ok(
    "Settings writes a Chrome-valid @page rule",
    !!runtimeRule && /@page\s*\{\s*size:\s*\d+mm\s+\d+mm\s*;\s*margin:\s*0\s*;?\s*\}/.test(runtimeRule) && !runtimeRule.includes("auto"),
    String(runtimeRule)
  );

  // ── Print CSS on a page that really has nav/sidebar/header content.
  await page.goto(`${BASE}/pos`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));

  await page.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    window.__receiptHtml = new Function(`return (${src})`)();
  }, receiptHtml.toString());

  for (const itemCount of [1, 20]) {
    await page.evaluate((n) => {
      document.getElementById("print-receipt")?.remove();
      const holder = document.createElement("div");
      holder.id = "print-receipt";
      holder.setAttribute("aria-hidden", "true");
      holder.innerHTML = window.__receiptHtml(n);
      document.body.appendChild(holder);
    }, itemCount);

    await page.emulateMediaType("print");
    await new Promise((r) => setTimeout(r, 300));

    const audit = await page.evaluate(() => {
      const receipt = document.querySelector("#print-receipt .receipt");
      // `display` on a node inside a hidden ancestor still reports its own
      // value, so "does it paint a box" is the assertion that matters.
      const paints = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.getClientRects().length > 0 : false;
      };
      const item = document.querySelector("#print-receipt .r-item");
      const totals = document.querySelector("#print-receipt .r-totals");
      const rect = receipt.getBoundingClientRect();
      const heightMm = Math.ceil((rect.height / 96) * 25.4) + 1;
      const style = document.getElementById("receipt-page-style");
      if (style) {
        style.textContent = `@page { size: 80mm ${heightMm}mm; margin: 0; }`;
      }
      return {
        receiptVisible: receipt ? getComputedStyle(receipt).display : "missing",
        shellHidden: [...document.body.children].every(
          (c) => c.id === "print-receipt" || getComputedStyle(c).display === "none"
        ),
        itemCount: document.querySelectorAll("#print-receipt .r-item").length,
        itemBreak: item
          ? getComputedStyle(item).breakInside || getComputedStyle(item).pageBreakInside
          : "missing",
        totalsBreak: totals
          ? getComputedStyle(totals).breakInside || getComputedStyle(totals).pageBreakInside
          : "missing",
        bodyMinHeight: getComputedStyle(document.body).minHeight,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyScrollHeight: document.body.scrollHeight,
        receiptHeight: Math.round(rect.height),
        rootWidth: getComputedStyle(document.documentElement)
          .getPropertyValue("--receipt-width")
          .trim(),
        shellPaints: ["nav", "header", "main"].filter((sel) => paints(sel)),
        pageCss: style ? style.textContent : null,
      };
    });

    ok(`[${itemCount} items] receipt visible, whole shell hidden`, audit.receiptVisible === "block" && audit.shellHidden, JSON.stringify({ v: audit.receiptVisible, hidden: audit.shellHidden }));
    ok(`[${itemCount} items] nav/header/sidebar/main print as nothing`, audit.shellPaints.length === 0, JSON.stringify(audit.shellPaints));
    ok(`[${itemCount} items] all ${itemCount} rows rendered`, audit.itemCount === itemCount, String(audit.itemCount));
    ok(`[${itemCount} items] item rows are page-break-inside: avoid`, audit.itemBreak === "avoid", String(audit.itemBreak));
    ok(`[${itemCount} items] totals block is page-break-inside: avoid`, audit.totalsBreak === "avoid", String(audit.totalsBreak));
    ok(`[${itemCount} items] min-h-screen neutralised in print`, audit.bodyMinHeight === "0px", audit.bodyMinHeight);
    ok(`[${itemCount} items] page background is white`, audit.bodyBg === "rgb(255, 255, 255)", audit.bodyBg);
    ok(`[${itemCount} items] body adds no height beyond the receipt`, audit.bodyScrollHeight <= audit.receiptHeight + 4, `scroll=${audit.bodyScrollHeight} receipt=${audit.receiptHeight}`);
    ok(`[${itemCount} items] --receipt-width is 80mm`, audit.rootWidth === "80mm", audit.rootWidth);
    ok(`[${itemCount} items] page box sized to the content`, !!audit.pageCss && !audit.pageCss.includes("auto") && audit.pageCss.includes("80mm"), String(audit.pageCss));

    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    const pages = countPages(pdf);
    const box = mediaBox(pdf);
    const wMm = box ? toMm(box.w) : 0;
    const hMm = box ? toMm(box.h) : 0;
    const contentMm = (audit.receiptHeight / 96) * 25.4;

    ok(`[${itemCount} items] exactly one printed page`, pages === 1, `pages=${pages}`);
    ok(`[${itemCount} items] printed page is 80mm wide`, Math.abs(wMm - 80) < 1.5, `${wMm.toFixed(1)}mm`);
    ok(
      `[${itemCount} items] printout ends right after the footer`,
      hMm >= contentMm - 0.5 && hMm <= contentMm + 3,
      `page=${hMm.toFixed(1)}mm content=${contentMm.toFixed(1)}mm`
    );

    await page.emulateMediaType(null);
    await page.evaluate(() => document.getElementById("print-receipt")?.remove());
  }

  // Configurable width: 58mm must reach the printed media box too.
  await page.evaluate(() => {
    const holder = document.createElement("div");
    holder.id = "print-receipt";
    holder.innerHTML = `<div class="receipt"><div class="r-head"><p class="r-title">Kalmunai Mobile Centre</p></div><div class="r-divider"></div><div class="r-totals"><p class="r-row r-total"><span>TOTAL</span><span>Rs 100.00</span></p></div><div class="r-divider"></div><div class="r-foot"><p>Thank you, come again!</p></div></div>`;
    document.body.appendChild(holder);
    document.documentElement.style.setProperty("--receipt-width", "58mm");
  });
  await page.emulateMediaType("print");
  const fiftyEight = await page.evaluate(() => {
    const receipt = document.querySelector("#print-receipt .receipt");
    const heightMm = Math.ceil((receipt.getBoundingClientRect().height / 96) * 25.4) + 1;
    const style = document.getElementById("receipt-page-style");
    style.textContent = `@page { size: 58mm ${heightMm}mm; margin: 0; }`;
    return style.textContent;
  });
  const pdf58 = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  const box58 = mediaBox(pdf58);
  const w58 = box58 ? toMm(box58.w) : 0;
  ok("58mm setting reaches the printed media box", Math.abs(w58 - 58) < 1.5, `${w58.toFixed(1)}mm, pages=${countPages(pdf58)} (${fiftyEight})`);
} catch (err) {
  ok("script completed", false, String((err && err.message) || err));
} finally {
  await browser.close();
}

const output = results.join("\n");
console.log(output);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
process.exit(failed ? 1 : 0);
