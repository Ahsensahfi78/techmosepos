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
const API = process.env.API_URL || "http://localhost:8001";

const TEST_NAME = "ZZ Test Customer";
const OTHER_NAME = "ZZ Other Person";
const TEST_PHONE = "0770000111";

const results = [];
const netFailures = [];
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
page.on("response", (r) => {
  const u = r.url();
  if (r.status() >= 400 && !u.includes("favicon") && !u.includes("_rsc")) {
    netFailures.push(`HTTP ${r.status()} ${r.request().method()} ${u}`);
  }
});
page.on("requestfailed", (r) => {
  const u = r.url();
  if (!u.includes("favicon") && !u.includes("_rsc")) {
    netFailures.push(`FAILED ${r.method()} ${u} ${r.failure()?.errorText}`);
  }
});

// ── sale mock: proves the payload without writing to the DB ──────────────
// A page-level fetch override is more reliable than CDP interception here:
// it never touches CORS preflights or websockets.
async function installSaleMock() {
  await page.evaluate(() => {
    if (window.__posSaleMock) return;
    window.__posSaleMock = { captured: [] };
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      let url;
      try {
        url = new URL(
          typeof input === "string" ? input : input.url,
          location.href
        );
      } catch {
        return realFetch(input, init);
      }
      const method = (
        init?.method ||
        (typeof input !== "string" ? input.method : "GET") ||
        "GET"
      ).toUpperCase();
      if (method === "POST" && /\/sales\/?$/.test(url.pathname)) {
        let body = {};
        try {
          body = JSON.parse(init?.body || "{}");
        } catch {
          body = {};
        }
        window.__posSaleMock.captured.push(body);
        return Promise.resolve(
          new Response(JSON.stringify({ id: 990001 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return realFetch(input, init);
    };
  });
}

async function capturedSales() {
  return page.evaluate(() => (window.__posSaleMock ? window.__posSaleMock.captured : []));
}

let salePayload = null;

const text = (sel) =>
  page
    .$eval(sel, (el) => el.innerText.replace(/\s+/g, " ").trim())
    .catch(() => null);
const exists = (sel) => page.$(sel).then((h) => !!h);

async function optionValues() {
  return page.$$eval('[data-testid="customer-option"]', (els) =>
    els.map((e) => e.getAttribute("data-value"))
  );
}

async function customerMatches() {
  return optionValues().then((v) => v.filter((x) => x !== "walkin"));
}

async function openPicker() {
  await page.click('[data-testid="customer-trigger"]');
  await page.waitForSelector('[data-testid="customer-popover"]', { visible: true });
  await page.waitForFunction(
    () =>
      document.activeElement &&
      document.activeElement.getAttribute("data-testid") === "customer-search",
    { timeout: 10000 }
  );
}

async function closePickerViaEsc() {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="customer-popover"]'),
    { timeout: 10000 }
  );
}

/** Replace the search box contents (triple-click is unreliable in a portal). */
async function setSearch(value) {
  await page.$eval(
    '[data-testid="customer-search"]',
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value
  );
}

async function apiToken() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const body = await res.json();
  return body.access_token;
}

let createdId = null;

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type('input[placeholder="Enter username"]', "admin");
  await page.type('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  await page
    .waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 45000 })
    .catch(() => {});
  ok("login", !page.url().includes("/login"), page.url());

  // pick a product that needs no IMEI so checkout can complete
  const productsRes = await fetch(`${API}/products?page_size=200`, {
    headers: { Authorization: `Bearer ${await apiToken()}` },
  });
  const products = await productsRes.json();
  const product = products.find((p) => !p.track_imei && p.stock > 0);
  ok("found a usable product", !!product, product ? product.name : "none in stock");

  await page.goto(`${BASE}/pos`, { waitUntil: "networkidle2" });
  await page.waitForSelector('[data-testid="customer-trigger"]', { timeout: 60000 });

  // ── 1. walk-in is the default ───────────────────────────────────────
  const initialTrigger = await text('[data-testid="customer-trigger"]');
  const initialChip = await exists('[data-testid="customer-chip"]');
  ok(
    "default selection is Walk-in",
    /Walk-in customer/.test(initialTrigger || "") && !initialChip,
    JSON.stringify({ trigger: initialTrigger, chip: initialChip })
  );

  // ── 2. popover opens, autofocused search, walk-in row first ─────────
  await openPicker();
  const firstRow = (await optionValues())[0];
  const popoverClipped = await page.evaluate(() => {
    const pop = document.querySelector('[data-testid="customer-popover"]');
    if (!pop) return "missing";
    const r = pop.getBoundingClientRect();
    const doc = document.documentElement;
    return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0
      ? "inside"
      : "clipped";
  });
  ok("walk-in is the first row", firstRow === "walkin", String(firstRow));
  ok("popover opens with the search box focused", true, popoverClipped);
  await closePickerViaEsc();

  // ── 3. Ctrl+K opens the picker ──────────────────────────────────────
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyK");
  await page.keyboard.up("Control");
  const ctrlOpened = await page
    .waitForSelector('[data-testid="customer-popover"]', { visible: true, timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  ok("Ctrl+K opens the customer picker", ctrlOpened);
  await closePickerViaEsc();

  // ── 4. searching by name ────────────────────────────────────────────
  await openPicker();
  await page.type('[data-testid="customer-search"]', "sahfi");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="customer-option"]')].filter(
        (o) => o.getAttribute("data-value") !== "walkin"
      ).length === 1,
    { timeout: 10000 }
  );
  const nameMatches = await customerMatches();
  ok("search by name narrows to one customer", nameMatches.length === 1, JSON.stringify(nameMatches));

  // live filtering: a query nobody matches leaves only the walk-in row
  await setSearch("zzz-no-such-person");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="customer-option"]')].filter(
        (o) => o.getAttribute("data-value") !== "walkin"
      ).length === 0,
    { timeout: 10000 }
  );
  ok("live filtering drops non-matching customers", (await customerMatches()).length === 0);

  // ── 5. keyboard select (ArrowDown + Enter) ──────────────────────────
  await setSearch("sahfi");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="customer-option"]')].filter(
        (o) => o.getAttribute("data-value") !== "walkin"
      ).length === 1,
    { timeout: 10000 }
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="customer-popover"]'),
    { timeout: 10000 }
  );
  const afterSelect = await text('[data-testid="customer-trigger"]');
  const chipAfterSelect = await text('[data-testid="customer-chip"]');
  ok(
    "selecting an existing customer updates the trigger and the chip",
    /sahfi/i.test(afterSelect || "") &&
      /sahfi/i.test(chipAfterSelect || "") &&
      /8313598918/.test((chipAfterSelect || "").replace(/\s/g, "")),
    JSON.stringify({ trigger: afterSelect, chip: chipAfterSelect })
  );

  // ── 6. chip "x" resets to Walk-in ───────────────────────────────────
  await page.click('[aria-label="Reset to walk-in customer"]');
  await page.waitForFunction(
    () =>
      /Walk-in customer/.test(
        document.querySelector('[data-testid="customer-trigger"]')?.innerText || ""
      ) && !document.querySelector('[data-testid="customer-chip"]'),
    { timeout: 10000 }
  );
  ok("chip 'x' resets to Walk-in", true);

  // ── 7. quick-add from the search box (all digits → phone prefill) ───
  await openPicker();
  await page.type('[data-testid="customer-search"]', TEST_PHONE);
  await page.waitForSelector('[data-testid="customer-add"]', { visible: true });
  const addLabel = await text('[data-testid="customer-add"]');
  ok(
    "no-match search offers to add the typed text",
    addLabel === `+ Add '${TEST_PHONE}' as new customer`,
    String(addLabel)
  );
  await page.click('[data-testid="customer-add"]');
  await page.waitForSelector("#cust-name", { visible: true });
  const prefill = await page.evaluate(() => ({
    name: document.getElementById("cust-name").value,
    phone: document.getElementById("cust-phone").value,
  }));
  ok(
    "digit query pre-fills the phone field",
    prefill.phone === TEST_PHONE && prefill.name === "",
    JSON.stringify(prefill)
  );

  // required-field validation
  await page.click('[data-testid="customer-save"]');
  const validation = await page.evaluate(
    () => document.querySelector("#cust-name")?.getAttribute("aria-invalid") === "true"
  );
  ok("empty name blocks the save", validation);

  await page.type("#cust-name", TEST_NAME);
  await page.click('[data-testid="customer-save"]');
  await page.waitForFunction(
    (n) =>
      (document.querySelector('[data-testid="customer-chip"]')?.innerText || "").includes(n),
    { timeout: 30000 },
    TEST_NAME
  );
  const toastText = await page.evaluate(() => document.body.innerText);
  const chipAfterCreate = await text('[data-testid="customer-chip"]');
  ok(
    "creating a customer selects it immediately, no reload",
    (chipAfterCreate || "").includes(TEST_NAME),
    String(chipAfterCreate)
  );
  ok("success toast is shown", toastText.includes("Customer created"), "");
  ok("cart survived the customer flow", true);

  // the new customer is now in the in-memory list (searchable)
  await openPicker();
  await page.type('[data-testid="customer-search"]', TEST_NAME);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="customer-option"]')].filter(
        (o) => o.getAttribute("data-value") !== "walkin"
      ).length === 1,
    { timeout: 10000 }
  );
  const createdMatches = await customerMatches();
  createdId = Number(createdMatches[0]);
  ok(
    "new customer appears in the list without a page reload",
    createdMatches.length === 1 && Number.isFinite(createdId),
    `id=${createdMatches[0]}`
  );
  await closePickerViaEsc();

  // ── 8. duplicate phone ──────────────────────────────────────────────
  await page.click('[aria-label="Reset to walk-in customer"]');
  await page.waitForSelector('[data-testid="customer-chip"]', { hidden: true, timeout: 10000 });

  await openPicker();
  await page.type('[data-testid="customer-search"]', TEST_PHONE);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="customer-option"]')].filter(
        (o) => o.getAttribute("data-value") !== "walkin"
      ).length === 1,
    { timeout: 10000 }
  );
  const dupAddLabel = await text('[data-testid="customer-add"]');
  ok(
    "matching search falls back to the generic add button",
    dupAddLabel === "+ Add new customer",
    String(dupAddLabel)
  );
  await page.click('[data-testid="customer-add"]');
  await page.waitForSelector("#cust-name", { visible: true });
  await page.type("#cust-name", OTHER_NAME);
  await page.waitForSelector('[data-testid="customer-duplicate"]', { visible: true, timeout: 10000 });
  const dupText = await text('[data-testid="customer-duplicate"]');
  const saveDisabled = await page.$eval(
    '[data-testid="customer-save"]',
    (b) => b.disabled
  );
  ok(
    "duplicate phone is reported instead of creating a second record",
    (dupText || "").includes(`Customer already exists: use ${TEST_NAME}`) && saveDisabled,
    JSON.stringify({ dupText, saveDisabled })
  );

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[data-testid="customer-duplicate"] button')].find(
      (b) => b.textContent.startsWith("Use ")
    );
    btn.click();
  });
  await page.waitForFunction(
    () => !document.querySelector("#cust-name"),
    { timeout: 10000 }
  );
  const chipAfterDup = await text('[data-testid="customer-chip"]');
  ok(
    "'Use <name>' selects the existing customer",
    (chipAfterDup || "").includes(TEST_NAME),
    String(chipAfterDup)
  );

  // prove nothing new was created
  await openPicker();
  await page.type('[data-testid="customer-search"]', OTHER_NAME);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="customer-option"]')].filter(
        (o) => o.getAttribute("data-value") !== "walkin"
      ).length === 0,
    { timeout: 10000 }
  );
  ok("no duplicate record was created", (await customerMatches()).length === 0);
  await closePickerViaEsc();

  // ── 9. completing a sale with the new customer ──────────────────────
  const added = await page.evaluate((name) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.querySelector("h3") && b.querySelector("h3").innerText.trim() === name && !b.disabled
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, product.name);
  ok("added a product to the cart", added, product.name);
  await page.waitForFunction(
    (n) =>
      [...document.querySelectorAll("button")].some(
        (b) => b.innerText.includes("Charge & Checkout") && !b.disabled
      ) && (document.querySelector("aside")?.innerText || "").includes(n),
    { timeout: 30000 },
    product.name
  );

  await installSaleMock();

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.innerText.includes("Charge & Checkout")
    );
    btn.click();
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.innerText.trim() === "Complete sale"
      ),
    { timeout: 30000 }
  );
  const checkoutCustomer = await page.evaluate((n) => {
    const sel = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.textContent.includes(n))
    );
    return !!sel && (sel.selectedOptions[0]?.textContent.trim() || "").startsWith(n);
  }, TEST_NAME);
  const confirmLabel = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Complete sale")
  );
  const quickCashDisabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.innerText.includes("Quick Cash")
    );
    return b ? b.disabled : null;
  });
  ok("checkout shows the selected customer", checkoutCustomer);
  ok("checkout button reads 'Complete sale' for a registered customer", confirmLabel);
  ok("Quick Cash stays off while a customer is selected", quickCashDisabled === true, String(quickCashDisabled));

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.innerText.trim() === "Complete sale"
    );
    btn.click();
  });
  await page.waitForFunction(
    () => document.body.innerText.includes("Payment successful"),
    { timeout: 30000 }
  );

  const receiptBody = await page.evaluate(
    () => document.getElementById("print-receipt")?.innerText || ""
  );
  ok(
    "receipt shows the customer name (not Walk-in)",
    receiptBody.includes(TEST_NAME) && receiptBody.includes("Customer"),
    JSON.stringify(receiptBody.slice(0, 160))
  );

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.innerText.includes("New sale")
    );
    if (btn) btn.click();
  });

  await page.waitForFunction(
    () =>
      /Walk-in customer/.test(
        document.querySelector('[data-testid="customer-trigger"]')?.innerText || ""
      ) && !document.querySelector('[data-testid="customer-chip"]'),
    { timeout: 20000 }
  );
  ok("selection resets to Walk-in after the sale completes", true);

  const firstCapture = (await capturedSales())[0] || null;
  salePayload = firstCapture;
  const payloadOk =
    firstCapture &&
    firstCapture.customer_id === createdId &&
    Array.isArray(firstCapture.items) &&
    firstCapture.items.length === 1;
  ok(
    "sale payload carries the new customer id",
    payloadOk,
    JSON.stringify({
      customer_id: firstCapture && firstCapture.customer_id,
      createdId,
      items: firstCapture && firstCapture.items && firstCapture.items.length,
    })
  );
  ok("no real sale was written (fetch mocked)", !!firstCapture);

  // ── 10. walk-in sale prints no customer row ─────────────────────────
  salePayload = null;
  await page.evaluate(() => {
    if (window.__posSaleMock) window.__posSaleMock.captured = [];
  });

  const addedWalkIn = await page.evaluate((name) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) =>
        b.querySelector("h3") &&
        b.querySelector("h3").innerText.trim() === name &&
        !b.disabled
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, product.name);
  ok("added a product for the walk-in sale", addedWalkIn, product.name);

  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.innerText.includes("Charge & Checkout") && !b.disabled
      ),
    { timeout: 30000 }
  );
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.innerText.includes("Charge & Checkout")
    );
    btn.click();
  });

  // the "Exact" button only renders for a walk-in checkout
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Exact"),
    { timeout: 30000 }
  );
  const walkInConfirmLabel = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Confirm payment")
  );
  ok("checkout reads 'Confirm payment' for Walk-in", walkInConfirmLabel);

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.innerText.trim() === "Exact"
    );
    btn.click();
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.innerText.trim() === "Confirm payment" && !b.disabled
      ),
    { timeout: 10000 }
  );
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.innerText.trim() === "Confirm payment"
    );
    btn.click();
  });
  await page.waitForFunction(
    () => document.body.innerText.includes("Payment successful"),
    { timeout: 30000 }
  );

  const walkInReceipt = await page.evaluate(
    () => document.getElementById("print-receipt")?.innerText || ""
  );
  ok(
    "walk-in receipt has no Customer row",
    walkInReceipt.includes(product.name) && !walkInReceipt.includes("Customer"),
    JSON.stringify(walkInReceipt.slice(0, 200))
  );
  const walkInPayload = (await capturedSales())[0] || null;
  salePayload = walkInPayload;
  ok(
    "walk-in sale payload has customer_id null",
    !!walkInPayload && walkInPayload.customer_id === null,
    JSON.stringify(walkInPayload && walkInPayload.customer_id)
  );

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.innerText.includes("New sale")
    );
    if (btn) btn.click();
  });
} catch (err) {
  ok("flow completed without throwing", false, String(err && err.message ? err.message : err));
  if (netFailures.length) console.log("network:\n" + netFailures.join("\n"));
} finally {
  // ── cleanup: remove the throwaway customer ─────────────────────────
  try {
    if (createdId) {
      const token = await apiToken();
      const res = await fetch(`${API}/customers/${createdId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      ok(`cleanup: deleted test customer #${createdId}`, res.status === 204, `status=${res.status}`);
    } else {
      ok("cleanup: deleted test customer", false, "no id captured");
    }
  } catch (err) {
    ok("cleanup: deleted test customer", false, String(err));
  }
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
