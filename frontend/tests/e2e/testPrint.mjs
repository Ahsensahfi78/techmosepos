// Automated browser test for the /barcodes "Test Print" button.
// Run: node tests/e2e/testPrint.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findLabelFrame(page) {
  for (const f of page.frames()) {
    const ok = await f
      .evaluate(() => !!document.querySelector(".page"))
      .catch(() => false);
    if (ok) return f;
  }
  return null;
}

async function inspectFrames(page) {
  const out = [];
  for (const frame of page.frames()) {
    let info;
    try {
      info = await frame.evaluate(() => {
        const pages = [...document.querySelectorAll(".page")];
        const label = document.querySelector(".barcode-test");
        const svg = document.querySelector(".test-barcode");
        const cs = label ? getComputedStyle(label) : null;
        return {
          url: location.href.slice(0, 60),
          printCalls: window.__printCalls || 0,
          bodyChildren: document.body ? document.body.children.length : -1,
          pageCount: pages.length,
          pageClasses: pages.map((p) => p.className),
          hasLabel: !!label,
          labelDisplay: cs ? cs.display : null,
          labelSize: label
            ? `${label.getBoundingClientRect().width.toFixed(1)}x${label.getBoundingClientRect().height.toFixed(1)}`
            : null,
          svgChildren: svg ? svg.childElementCount : -1,
        };
      });
    } catch (err) {
      info = { url: "ERR", error: String(err).slice(0, 120) };
    }
    out.push(info);
  }
  return out;
}

/**
 * Re-check the print frame with print media emulated: this is the CSS the
 * printer actually receives. Screenshots/DOM under screen media would pass
 * even if `@media print { body > * { display: none } }` hid everything.
 */
async function assertPrintMedia(page) {
  const frame = await findLabelFrame(page);
  if (!frame) return { error: "label frame not found" };

  await page.emulateMediaType("print");
  let report;
  try {
    report = await frame.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const g = (el) => (el ? getComputedStyle(el) : null);
      let pageRule = null;
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const r of Array.from(rules || [])) {
          if ((r.cssText || "").startsWith("@page")) pageRule = r.cssText;
        }
      }
      const text = q(".barcode-test-text");
      const code = q(".barcode-code");
      const label = q(".barcode-test");
      const page = q(".page");
      const svg = q(".test-barcode");
      const pageRect = page ? page.getBoundingClientRect() : null;
      const svgRect = svg ? svg.getBoundingClientRect() : null;
      return {
        printMediaActive: window.matchMedia("print").matches,
        pageDisplay: g(page)?.display,
        pageWidth: g(page)?.width,
        pageHeight: g(page)?.height,
        pageCount: document.querySelectorAll(".page").length,
        labelDisplay: g(label)?.display,
        labelBorder: g(label)?.borderTopWidth,
        labelText: text?.textContent || "",
        textColor: g(text)?.color,
        textFontSize: g(text)?.fontSize,
        codeColor: g(code)?.color,
        codeFontSize: g(code)?.fontSize,
        svgBars: svg ? svg.querySelectorAll("rect").length : 0,
        pageRule,
        // rect() collapses to 0 for a frame parked at left:-10000px, so the
        // geometry check runs separately under screen media below.
        _rects: { page: pageRect ? pageRect.width : 0, svg: svgRect ? svgRect.width : 0 },
      };
    });
  } finally {
    await page.emulateMediaType("screen");
  }

  // Same stylesheet under screen media, but real geometry this time.
  report.geometry = await frame.evaluate(() => {
    const page = document.querySelector(".page");
    const svg = document.querySelector(".test-barcode");
    const label = document.querySelector(".barcode-test");
    const pr = page ? page.getBoundingClientRect() : null;
    const sr = svg ? svg.getBoundingClientRect() : null;
    const lr = label ? label.getBoundingClientRect() : null;
    return {
      pageW: pr ? pr.width : 0,
      pageH: pr ? pr.height : 0,
      labelW: lr ? lr.width : 0,
      labelH: lr ? lr.height : 0,
      svgW: sr ? sr.width : 0,
      svgH: sr ? sr.height : 0,
      svgFillRatio: pr && pr.width > 0 && sr ? Number((sr.width / pr.width).toFixed(3)) : null,
      labelFillRatio: pr && pr.width > 0 && lr ? Number((lr.width / pr.width).toFixed(3)) : null,
    };
  });
  return report;
}

/** Write the frame's HTML out and count the pages Chrome paginates it into. */
async function pdfProbe(browser, frameHtml, labelSections) {
  const file = path.join(HERE, "label-frame.html");
  // Duplicate the single label so the .page:last-child rule is exercised:
  // 3 labels must become 3 pages, never 4 (the old trailing blank page).
  const section = frameHtml.match(
    /<section class="page"[\s\S]*?<\/section>/,
  )?.[0];
  let html = frameHtml;
  if (section && labelSections === 3) {
    html = frameHtml.replace("</body>", `${section}${section}</body>`);
  }
  fs.writeFileSync(file, html, "utf8");

  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    const pdfPath = path.join(HERE, "label-frame.pdf");
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      preferCSSPageSize: true,
    });
    const pdf = fs.readFileSync(pdfPath, "latin1");
    const mediaBoxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
    const counts = [...pdf.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,120}?\/Count\s+(\d+)/g)].map(
      (m) => Number(m[1]),
    );
    const totalPages = counts.length ? Math.max(...counts) : null;
    return {
      mediaBoxPt: mediaBoxes.length
        ? [
            Number(mediaBoxes[0][1]),
            Number(mediaBoxes[0][2]),
          ]
        : null,
      // 50mm = 141.73pt, 30mm = 85.04pt
      pages: totalPages,
      pdfBytes: pdf.length,
      sections: html.match(/<section class="page"/g)?.length ?? 0,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();

  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

  // Runs in every frame (including our label iframe) before page scripts.
  await page.evaluateOnNewDocument(() => {
    window.__printCalls = window.__printCalls || 0;
    window.print = function () {
      window.__printCalls += 1;
      const links = [...document.querySelectorAll("link[rel='stylesheet']")];
      window.__printProbe = {
        readyState: document.readyState,
        unloadedSheets: links.filter((l) => !l.sheet).length,
        bodyChildren: document.body ? document.body.children.length : -1,
        at: Date.now(),
      };
      window.__printDoc = document.documentElement.outerHTML.slice(0, 8000);
      return undefined;
    };
  });

  const result = { steps: [], frames: [], ok: false };

  try {
    // ── login ────────────────────────────────────────────────────────────
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector('input[placeholder="Enter username"]', { timeout: 30000 });
    await page.type('input[placeholder="Enter username"]', "admin");
    await page.type('input[type="password"]', "admin123");
    await page.click('button[type="submit"]');
    try {
      await page.waitForFunction(
        () => !location.pathname.startsWith("/login"),
        { timeout: 45000 },
      );
    } catch {
      const err = await page.evaluate(
        () => document.querySelector("form")?.innerText || "",
      );
      throw new Error(`login stuck on ${page.url()} :: ${err.replace(/\s+/g, " ")}`);
    }
    result.steps.push(`after login url=${page.url()}`);

    // ── barcodes page ────────────────────────────────────────────────────
    await page.goto(`${BASE}/barcodes`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("select", { timeout: 30000 });
    await sleep(1500);

    const buttonInfo = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].map((b) =>
        b.textContent.trim().replace(/\s+/g, " "),
      );
      const testBtn = [...document.querySelectorAll("button")].find((b) =>
        /Test Print/i.test(b.textContent),
      );
      return {
        buttons: btns,
        hasTestPrint: !!testBtn,
        disabled: testBtn ? testBtn.disabled : null,
        visible: testBtn ? testBtn.offsetParent !== null : null,
        labelWidth: document.querySelector(
          'input[aria-label], input[type="number"]',
        )?.value,
        labelSizeInputs: [...document.querySelectorAll('input[type="number"]')].map(
          (i) => i.value,
        ),
        storedLabelSize: localStorage.getItem("pos_label_size"),
      };
    });
    result.button = buttonInfo;
    result.steps.push(`button present=${buttonInfo.hasTestPrint}`);

    if (!buttonInfo.hasTestPrint) {
      await page.screenshot({ path: "tests/e2e/missing-test-print.png" });
      throw new Error("Test Print button not found on /barcodes");
    }

    // ── click ────────────────────────────────────────────────────────────
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        /Test Print/i.test(x.textContent),
      );
      b.scrollIntoView({ block: "center" });
      b.click();
    });

    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const hits = [];
      for (const f of page.frames()) {
        try {
          const n = await f.evaluate(() => window.__printCalls || 0);
          if (n > 0) hits.push(n);
        } catch {
          /* ignore */
        }
      }
      if (hits.length) break;
    }

    result.frames = await inspectFrames(page);
    result.printCalls = await Promise.all(
      page.frames().map((f) =>
        f.evaluate(() => window.__printCalls || 0).catch(() => -1),
      ),
    );
    result.probe = await Promise.all(
      page.frames().map((f) =>
        f.evaluate(() => window.__printProbe || null).catch(() => null),
      ),
    );
    const fired = result.probe.filter(Boolean);
    result.ok = fired.length > 0;
    // Chrome refuses / blanks a print() issued while the frame is still
    // loading its stylesheets, so the frame must be fully loaded first.
    result.strict =
      fired.length > 0 &&
      fired.every((p) => p.readyState === "complete" && p.unloadedSheets === 0);

    // …and the frame has to actually be visible under print media.
    result.printMedia = await assertPrintMedia(page);
    const pm = result.printMedia;

    const labelFrame = await findLabelFrame(page);
    result.frameHtmlBytes = labelFrame
      ? (await labelFrame.evaluate(() => document.documentElement.outerHTML)).length
      : 0;
    result.appDocumentHasLabels =
      (await page.evaluate(
        () => document.querySelectorAll(".barcode-print-portal").length,
      )) === 0;
    result.appPrintBlocked =
      (await page.evaluate(() => window.__printCalls || 0)) === 0;

    result.pdf = null;
    if (labelFrame) {
      const html = await labelFrame.evaluate(
        () => document.documentElement.outerHTML,
      );
      try {
        result.pdf = await pdfProbe(browser, html, 3);
      } catch (err) {
        result.pdf = { error: String(err).slice(0, 200) };
      }
    }

    result.contentVisible =
      pm.printMediaActive === true &&
      pm.pageCount === 1 &&
      /^(block|flex)$/.test(      pm.pageDisplay || "") &&
      // 38mm x 25mm @96dpi CSS px = 143.62 x 94.49
      Math.abs(parseFloat(pm.pageWidth || "0") - 143.62) < 3 &&
      Math.abs(parseFloat(pm.pageHeight || "0") - 94.49) < 3 &&
      // 2mm safe-area inset -> label box is 34mm x 21mm = 128.52 x 79.37px
      Math.abs(pm.geometry.labelW - 128.52) < 3 &&
      Math.abs(pm.geometry.labelH - 79.37) < 3 &&
      /^rgb\(0, 0, 0\)$/.test(pm.textColor || "") &&
      parseFloat(pm.textFontSize || "0") >= 20 &&
      parseFloat(pm.codeFontSize || "0") >= 9 &&
      pm.svgBars > 2 &&
      pm.geometry.svgFillRatio !== null &&
      pm.geometry.svgFillRatio >= 0.85 &&
      pm.geometry.labelFillRatio !== null &&
      pm.geometry.labelFillRatio >= 0.85 &&
      pm.geometry.svgH > 10 &&
      /size:\s*38mm 25mm/.test(pm.pageRule || "") &&
      /margin:\s*0(px)?/.test(pm.pageRule || "") &&
      result.appPrintBlocked &&
      result.appDocumentHasLabels &&
      result.frameHtmlBytes > 500;

    result.pdfLabelShaped =
      !!result.pdf &&
      !result.pdf.error &&
      result.pdf.sections === 3 &&
      result.pdf.pages === 3 &&
      result.pdf.mediaBoxPt !== null &&
      // 38mm x 25mm @72dpi pt = 107.72 x 70.87
      Math.abs(result.pdf.mediaBoxPt[0] - 107.72) < 2 &&
      Math.abs(result.pdf.mediaBoxPt[1] - 70.87) < 2;

    const toasts = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="toast"], [role="alert"]')]
        .map((n) => n.textContent.trim())
        .filter(Boolean),
    );
    result.toasts = toasts;
    result.logs = logs.slice(-30);
    await page.screenshot({ path: "tests/e2e/test-print-result.png" });
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    result.logs = logs.slice(-30);
    try {
      await page.screenshot({ path: "tests/e2e/test-print-error.png" });
    } catch {
      /* ignore */
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.strict && result.contentVisible && result.pdfLabelShaped ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
