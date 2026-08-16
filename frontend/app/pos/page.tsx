"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, master } from "@/lib/api";
import { useStock } from "@/hooks/useStock";
import { useAuth } from "@/lib/auth-context";
import { categoryIcon, formatMoney } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import { stockTone } from "@/components/ui/StockBadge";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import CartPanel, { type CartLine, lineSubtotal } from "@/components/CartPanel";
import CheckoutModal, { type SplitLine } from "@/components/CheckoutModal";
import ReceiptModal from "@/components/ReceiptModal";
import { smartSearch, bestMatch, type ProductMatch } from "@/lib/search";
import {
  can,
  emptyContext,
  permissionForAction,
  understand,
  updateContextFromAction,
  type Confidence,
  type NlAction,
  type NlAskProduct,
  type NlContext,
} from "@/lib/nlp";
import {
  checkStock,
  invalidCartLines,
  stockWarningMessage,
} from "@/lib/stockValidation";
import {
  createParkedOrder,
  parkedLineTotal,
  removeParked,
  updateParkedNote,
  type ParkedCartLine,
  type ParkedOrder,
} from "@/lib/park";
import { saveDraft, loadDraft, clearDraft, type DraftOrder } from "@/lib/draft";
import { useVoice } from "@/lib/voice";
import {
  enqueueSale,
  loadQueue,
  removeQueued,
  type QueuedSale,
} from "@/lib/offline";
import type { Customer, PrintSettings, Product } from "@/lib/types";

function Highlighted({
  text,
  ranges,
}: {
  text: string;
  ranges: { start: number; end: number }[];
}) {
  if (!ranges.length) return <>{text}</>;
  const r = ranges[0];
  return (
    <>
      {text.slice(0, r.start)}
      <mark className="rounded bg-amber-200/80 px-0.5 text-amber-900">
        {text.slice(r.start, r.end)}
      </mark>
      {text.slice(r.end)}
    </>
  );
}

const SHORTCUTS: { key: string; label: string }[] = [
  { key: "F1 / ?", label: "Keyboard shortcuts help" },
  { key: "F2", label: "Search products (name / SKU / barcode)" },
  { key: "F3", label: "Scan barcode / SKU" },
  { key: "F4", label: "Select customer" },
  { key: "F6", label: "Hold current invoice" },
  { key: "F7", label: "Held / parked invoices" },
  { key: "F8", label: "Charge & checkout" },
  { key: "F9", label: "Transaction history" },
  { key: "F10", label: "Sales returns" },
  { key: "Esc", label: "Close dialogs" },
  { key: "Enter", label: "Confirm / search / add to cart" },
];

/**
 * Phrases that explicitly ask to *see* products. Voice input only filters the
 * grid for these; any other plain product name ("chargers") means "add to cart".
 */
const VOICE_SEARCH_VERBS =
  /^(search|search for|find|find a|find me|find the|look for|looking for|look up|show me|show|view|list|is there a|do you have a|got)\b/i;

export default function PosPage() {
  const { user } = useAuth();
  const { products, connected, applyOptimisticStock } = useStock();
  const { toast } = useToast();
  const router = useRouter();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [scanResults, setScanResults] = useState<ProductMatch[]>([]);
  const [category, setCategory] = useState("All");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const customerSelectRef = useRef<HTMLSelectElement>(null);
  const submittingRef = useRef(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [pointsUsed, setPointsUsed] = useState(0);
  const [method, setMethod] = useState("cash");
  const [imeis, setImeis] = useState<Record<number, string[]>>({});

  const [receipt, setReceipt] = useState<{
    id: string | number;
    lines: CartLine[];
    subtotal: number;
    discount: number;
    tax: number;
    pointsUsed: number;
    total: number;
    paid: number;
    due: number;
    change: number;
    method: string;
    payments?: SplitLine[];
    offline?: boolean;
    customer: string | null;
  } | null>(null);

  const [printSettings, setPrintSettings] = useState<PrintSettings>({});

  const [parked, setParked] = useState<ParkedOrder[]>([]);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [parkedSearch, setParkedSearch] = useState("");
  const [recoveredDraft, setRecoveredDraft] = useState<DraftOrder | null>(null);

  const [nlCtx, setNlCtx] = useState<NlContext>(emptyContext());
  const [nlConfirm, setNlConfirm] = useState<{
    message: string;
    run: () => void;
  } | null>(null);
  const [pickProduct, setPickProduct] = useState<{
    term: string;
    qty: number;
    matches: ProductMatch[];
    on: NlAskProduct["on"];
  } | null>(null);

  const voice = useVoice({
    onCommand: (cmd) => {
      const raw = cmd.raw.trim();
      if (!raw) return;
      voiceDispatchedRef.current = true;
      handleVoiceTranscript(raw);
    },
  });
  const voiceInterimRef = useRef<string | null>(null);
  const voiceDispatchedRef = useRef(false);

  useEffect(() => {
    const s = voice.state;
    if (s.status === "listening") {
      voiceInterimRef.current = s.interim;
      setSearch(s.interim);
    } else if (!voiceDispatchedRef.current && voiceInterimRef.current !== null) {
      // Listening ended without a command (cancelled / no speech) — drop the
      // leftover partial transcript instead of leaving it to filter the grid.
      setSearch((prev) =>
        prev === voiceInterimRef.current ? "" : prev
      );
      voiceInterimRef.current = null;
    } else {
      voiceInterimRef.current = null;
    }
  }, [voice.state]);

  useEffect(() => {
    if (voice.state.status === "error") {
      toast(voice.state.message, "error");
      voice.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.state]);

  const [browserOnline, setBrowserOnline] = useState(true);
  const [pendingQueue, setPendingQueue] = useState<QueuedSale[]>([]);
  const prevConnected = useRef<boolean | null>(null);
  const flushingRef = useRef(false);

  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const offline = !connected || !browserOnline;

  useEffect(() => {
    const queue = loadQueue();
    if (queue.length) setPendingQueue(queue);
  }, []);

  // Fetch print-time settings (store name / currency / receipt footer) on
  // mount and again whenever a new receipt is shown so the footer is always
  // current — no app restart needed.
  useEffect(() => {
    let cancelled = false;
    api.settings
      .print()
      .then((s) => {
        if (!cancelled) setPrintSettings(s);
      })
      .catch(() => {
        /* print settings are optional — fall back to defaults */
      });
    return () => {
      cancelled = true;
    };
  }, [receipt?.id]);

  useEffect(() => {
    const prev = prevConnected.current;
    prevConnected.current = connected;
    if (connected && (prev === false || prev === null)) {
      flushQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  async function flushQueue() {
    if (flushingRef.current) return;
    const queue = loadQueue();
    if (queue.length === 0) return;
    flushingRef.current = true;
    let synced = 0;
    for (const q of queue) {
      try {
        await api.sales.create(q.input);
        synced++;
        removeQueued([q.id]);
      } catch {
        break;
      }
    }
    flushingRef.current = false;
    setPendingQueue(loadQueue());
    if (synced > 0) {
      toast(
        `Synced ${synced} offline sale${synced > 1 ? "s" : ""} to the server`,
        "success"
      );
    }
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("techmos-parked");
      if (raw) setParked(JSON.parse(raw) as ParkedOrder[]);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("techmos-parked", JSON.stringify(parked));
    } catch {
      // ignore
    }
  }, [parked]);

  useEffect(() => {
    master.customers
      .list({ page_size: 100 })
      .then((res) => setCustomers(res.items))
      .catch(() => {});
  }, []);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((p) => p.category)))],
    [products]
  );

  const gridItems = useMemo(() => {
    if (!search.trim()) {
      return products
        .filter((p) => category === "All" || p.category === category)
        .map((p) => ({
          product: p,
          field: "name" as const,
          exact: true,
          score: 0,
          ranges: [] as { start: number; end: number }[],
        }));
    }
    return smartSearch(products, search, 24).filter(
      (m) => category === "All" || m.product.category === category
    );
  }, [products, search, category]);

  const subtotal = cart.reduce((s, l) => s + lineSubtotal(l), 0);
  const lineDiscounts = cart.reduce(
    (s, l) => s + (l.lineDiscount ?? 0),
    0
  );
  const discountTotal = lineDiscounts + discount;
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);

  const chargeable = Math.max(0, subtotal - discountTotal + tax);
  const pointsCap = Math.min(customer?.loyalty_points ?? 0, Math.floor(chargeable));
  const effectivePoints = Math.min(pointsUsed, pointsCap);
  const total = chargeable - effectivePoints;

  // Live stock lookup so quantities are validated against current availability.
  const stockById = useMemo(() => {
    const map: Record<number, number> = {};
    products.forEach((p) => {
      map[p.id] = p.stock;
    });
    return map;
  }, [products]);

  function availableOf(line: CartLine): number {
    return stockById[line.product.id] ?? line.product.stock;
  }

  const cartInvalid = useMemo(
    () =>
      cart.some(
        (l) => !checkStock(stockById[l.product.id] ?? l.product.stock, l.qty).ok
      ),
    [cart, stockById]
  );

  function selectCustomer(c: Customer | null) {
    setCustomer(c);
    setPointsUsed(0);
  }

  function buildCartFromLines(lines: ParkedCartLine[]): CartLine[] {
    const productById = new Map(products.map((p) => [p.id, p]));
    const restored: CartLine[] = [];
    for (const line of lines) {
      const product = productById.get(line.product_id);
      if (!product) continue;
      const existing = restored.find((l) => l.product.id === product.id);
      if (existing) {
        existing.qty += line.qty;
        existing.unitPrice = line.unitPrice ?? existing.unitPrice;
        existing.lineDiscount = (existing.lineDiscount ?? 0) + (line.lineDiscount ?? 0);
      } else {
        restored.push({
          product,
          qty: line.qty,
          unitPrice: line.unitPrice,
          lineDiscount: line.lineDiscount,
        });
      }
    }
    return restored;
  }

  function addToCartQty(product: Product, qty: number) {
    const avail = stockById[product.id] ?? product.stock;
    const check = checkStock(avail, qty);
    if (check.out) {
      toast(`"${product.name}" is out of stock`, "error");
      return;
    }
    const existing = cart.find((l) => l.product.id === product.id);
    const requested = (existing?.qty ?? 0) + qty;
    const requestedCheck = checkStock(avail, requested);
    if (existing && qty === 1 && requestedCheck.over) {
      toast(`Only ${avail} of "${product.name}" are available`, "info");
      return;
    }
    if (existing) {
      setCart((prev) =>
        prev.map((l) =>
          l.product.id === product.id ? { ...l, qty: requested } : l
        )
      );
    } else {
      setCart((prev) => [...prev, { product, qty: requested }]);
    }
    if (requestedCheck.over) {
      toast(
        `"${product.name}": only ${avail} available, you requested ${requested} — fix in the cart`,
        "error"
      );
    }
  }

  function addToCart(product: Product) {
    addToCartQty(product, 1);
  }

  function handleScan(value: string) {
    const q = value.trim();
    setScanInput("");
    if (!q) return;
    const best = bestMatch(products, q);
    if (best) {
      addToCartQty(best.product as Product, 1);
      setScanResults([]);
    } else {
      const matches = smartSearch(products, q, 8);
      if (matches.length === 0) {
        toast(`No product found for "${q}"`, "error");
      } else {
        setScanResults(matches);
      }
    }
    scanRef.current?.focus();
  }

  /** Run natural language from the search box and act on the result. */
  function handleSearchSubmit() {
    const raw = search.trim();
    if (!raw) return;
    // A pure barcode/SKU scan is handled by the normal scan flow.
    if (/^\d+$/.test(raw)) {
      handleScan(raw);
      setSearch("");
      return;
    }
    handleVoiceTranscript(raw);
  }

  /** Route a spoken or typed phrase through the NL engine into POS actions. */
  function handleVoiceTranscript(raw: string) {
    const text = raw.trim();
    if (!text) return;
    if (/^\d+$/.test(text)) {
      handleScan(text);
      return;
    }
    const outcome = understand(text, {
      products,
      cart,
      customers,
      ctx: nlCtx,
    });
    // Speaking a bare product name ("chargers", "coca cola") means "add it to
    // the cart" — the search box still filters when the phrase names a verb.
    if (
      outcome.action?.kind === "plain_search" &&
      !VOICE_SEARCH_VERBS.test(text)
    ) {
      const add = understand(`add ${outcome.action.term}`, {
        products,
        cart,
        customers,
        ctx: nlCtx,
      });
      runNlAction(add.action, add.confidence, add.ctx);
      return;
    }
    runNlAction(outcome.action, outcome.confidence, outcome.ctx);
  }

  function deny(permission: string) {
    toast(
      `Your role (${user?.role ?? "unknown"}) doesn't have the "${permission}" permission. Ask a manager or admin to do it for you.`,
      "error"
    );
  }

  function runNlAction(
    action: NlAction | null,
    confidence: Confidence,
    ctx: NlContext
  ) {
    setSearch("");
    if (!action) {
      toast("I didn't quite catch that — please try again.", "info");
      return;
    }
    if (action.kind === "multi") {
      for (const step of action.steps) {
        runNlStep(step, confidence);
      }
      setNlCtx(ctx);
      return;
    }
    setNlCtx((prev) => updateContextFromAction(action, prev));
    runNlStep(action, confidence);
  }

  function runNlStep(action: NlAction, confidence: Confidence) {
    const clarification =
      action.kind === "ask" || action.kind === "ask_product";
    if (
      confidence === "low" &&
      action.kind !== "plain_search" &&
      !clarification
    ) {
      toast("I didn't quite catch that — please try again.", "info");
      return;
    }
    const permission = permissionForAction(action);
    if (!can(user?.role, permission)) {
      deny(permission);
      return;
    }
    switch (action.kind) {
      case "ask":
        toast(action.message, "info");
        return;
      case "ask_product": {
        const { term, qty, matches, on } = action.ask;
        if (matches.length === 0) {
          toast(`No product found for "${term}"`, "error");
          return;
        }
        setPickProduct({ term, qty, matches, on });
        return;
      }
      case "plain_search": {
        setSearch(action.term);
        searchRef.current?.focus();
        return;
      }
      case "add_to_cart": {
        if (action.ask) {
          const { term, qty, matches, on } = action.ask;
          if (matches.length === 0) {
            toast(`No product found for "${term}"`, "error");
            return;
          }
          setPickProduct({ term, qty, matches, on });
          return;
        }
        const parts: string[] = [];
        let added = 0;
        for (const l of action.lines) {
          const avail = stockById[l.product.id] ?? l.product.stock;
          if (avail <= 0) {
            toast(`"${l.product.name}" is out of stock`, "error");
            continue;
          }
          addToCartQty(l.product, l.qty);
          added++;
          parts.push(l.qty > 1 ? `${l.qty} × "${l.product.name}"` : `"${l.product.name}"`);
        }
        if (added > 0) toast(`Added ${parts.join(" and ")}`, "success");
        return;
      }
      case "remove_from_cart": {
        if (!action.product) {
          toast("Which product should I remove?", "info");
          return;
        }
        const target = cart.find((l) => l.product.id === action.product!.id);
        if (!target) {
          toast(`"${action.product.name}" is not in the cart`, "info");
          return;
        }
        removeLine(action.product.id);
        return;
      }
      case "set_cart_qty": {
        if (!action.product) {
          toast("Which product's quantity should I change?", "info");
          return;
        }
        const line = cart.find((l) => l.product.id === action.product!.id);
        if (!line) {
          addToCartQty(action.product, action.qty);
          toast(
            action.qty > 1
              ? `Added ${action.qty} × "${action.product.name}"`
              : `Added "${action.product.name}"`,
            "success"
          );
          return;
        }
        setQty(action.product.id, action.qty);
        toast(`"${action.product.name}" set to ${action.qty}`, "success");
        return;
      }
      case "decrease_cart_qty": {
        if (!action.product) {
          toast("Which product should I remove from the cart?", "info");
          return;
        }
        const line = cart.find((l) => l.product.id === action.product!.id);
        if (!line) {
          toast(`"${action.product.name}" is not in the cart`, "info");
          return;
        }
        if (line.qty <= 1) removeLine(line.product.id);
        else setQty(line.product.id, line.qty - 1);
        return;
      }
      case "show_cart":
        setMobileCartOpen(true);
        toast(cart.length > 0 ? "Here's your cart" : "The cart is empty", "info");
        return;
      case "clear_cart":
        requireNlConfirm("Clear the whole cart? This removes every item.", () => {
          setCart([]);
          setImeis({});
          clearDraft();
          toast("Cart cleared", "info");
        });
        return;
      case "hold_invoice":
        if (cart.length === 0) {
          toast("The cart is empty — nothing to hold", "info");
          return;
        }
        holdCart();
        return;
      case "open_held":
      case "resume_invoice":
        setParkedOpen(true);
        toast("Here are your held invoices", "info");
        return;
      case "cancel_invoice":
        if (cart.length === 0) {
          toast("The cart is already empty", "info");
          return;
        }
        requireNlConfirm(
          "Cancel this invoice? The current cart will be cleared.",
          () => {
            resetAfterSale();
            toast("Invoice cancelled", "info");
          }
        );
        return;
      case "new_invoice":
        if (cart.length === 0) {
          setMobileCartOpen(false);
          setPayOpen(false);
          toast("Started a new invoice", "success");
          return;
        }
        requireNlConfirm(
          "Start a new invoice? The current cart will be cleared.",
          () => {
            resetAfterSale();
            toast("New invoice started", "success");
          }
        );
        return;
      case "checkout": {
        if (cart.length === 0) {
          toast("The cart is empty — add products first", "info");
          return;
        }
        if (cartInvalid) {
          toast("Some quantities exceed stock — fix them before checkout", "error");
          return;
        }
        if (action.method) setMethod(action.method);
        setPayOpen(true);
        toast("Opening checkout…", "info");
        return;
      }
      case "select_customer":
        selectCustomer(action.customer);
        toast(`Customer set: ${action.customer.name}`, "success");
        return;
      case "find_customer": {
        const term = action.term.toLowerCase();
        const found = customers.find((c) => c.name.toLowerCase().includes(term));
        if (found) {
          selectCustomer(found);
          toast(`Customer set: ${found.name}`, "success");
        } else {
          toast(`No customer found for "${action.term}"`, "error");
        }
        return;
      }
      case "find_invoice":
      case "invoice_customer":
      case "invoice_items":
      case "print_invoice":
        if (action.invoiceNo) {
          router.push(`/transactions?q=${encodeURIComponent(action.invoiceNo)}`);
        } else {
          router.push("/transactions");
        }
        return;
      case "today_sales":
        router.push("/reports");
        return;
      case "stock_report":
        router.push("/inventory");
        return;
      case "product_stock": {
        if (!action.product) {
          toast("Which product's stock would you like to check?", "info");
          return;
        }
        const stock = stockById[action.product.id] ?? action.product.stock;
        toast(
          stock > 0
            ? `"${action.product.name}" has ${stock} in stock`
            : `"${action.product.name}" is out of stock`,
          stock > 0 ? "success" : "error"
        );
        return;
      }
      case "create_return":
        if (action.invoiceNo) {
          router.push(`/transactions?q=${encodeURIComponent(action.invoiceNo)}`);
        } else {
          router.push("/sales?return=1");
        }
        return;
      case "start_return":
        router.push("/sales?return=1");
        return;
      case "open_page": {
        const routes: Record<string, string> = {
          products: "/products",
          customers: "/customers",
          reports: "/reports",
          settings: "/settings",
          inventory: "/inventory",
          dashboard: "/",
          purchases: "/purchases",
          users: "/users",
          quotations: "/quotations",
          repairs: "/repairs",
          suppliers: "/suppliers",
          history: "/transactions",
          returns: "/sales?return=1",
          expenses: "/expenses",
          income: "/income",
          cheques: "/cheques",
          warranty: "/warranty",
        };
        const path = routes[action.page];
        if (path) router.push(path);
        else toast(`I don't know where "${action.page}" is`, "error");
        return;
      }
      case "open_history":
        router.push("/transactions");
        return;
      case "unknown":
        toast("I didn't quite catch that — please try again.", "info");
        return;
    }
  }

  function requireNlConfirm(message: string, run: () => void) {
    setNlConfirm({ message, run });
  }


  function setQty(id: number, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.product.id !== id));
      return;
    }
    const line = cart.find((l) => l.product.id === id);
    setCart((prev) =>
      prev.map((l) => (l.product.id === id ? { ...l, qty } : l))
    );
    if (line) {
      const avail = availableOf(line);
      if (qty > avail) {
        toast(
          `Only ${avail} of "${line.product.name}" are available. You requested ${qty}.`,
          "error"
        );
      }
    }
  }

  function increment(id: number) {
    const line = cart.find((l) => l.product.id === id);
    if (!line) return;
    const avail = availableOf(line);
    if (line.qty >= avail) {
      toast(`Only ${avail} of "${line.product.name}" are available`, "info");
      return;
    }
    setCart((prev) =>
      prev.map((l) => (l.product.id === id ? { ...l, qty: l.qty + 1 } : l))
    );
  }

  function decrement(id: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.product.id === id ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0)
    );
  }

  function quickAdd(id: number, n: number) {
    const line = cart.find((l) => l.product.id === id);
    if (!line) return;
    const avail = availableOf(line);
    const target = Math.min(line.qty + n, avail);
    if (target === line.qty) {
      toast(`Only ${avail} of "${line.product.name}" are available`, "info");
      return;
    }
    if (line.qty + n > avail) {
      toast(
        `"${line.product.name}": only ${avail} available — set quantity to ${target}`,
        "info"
      );
    }
    setCart((prev) =>
      prev.map((l) => (l.product.id === id ? { ...l, qty: target } : l))
    );
  }

  function setToAvailable(id: number) {
    const line = cart.find((l) => l.product.id === id);
    if (!line) return;
    const avail = availableOf(line);
    setCart((prev) =>
      prev.map((l) => (l.product.id === id ? { ...l, qty: avail } : l))
    );
    toast(`"${line.product.name}" set to ${avail}`, "success");
  }

  function removeLine(id: number) {
    const line = cart.find((l) => l.product.id === id);
    setCart((prev) => prev.filter((l) => l.product.id !== id));
    setImeis((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
    if (line) toast(`Removed "${line.product.name}"`, "info");
  }

  function changeLine(
    id: number,
    patch: { unitPrice?: number; lineDiscount?: number }
  ) {
    setCart((prev) =>
      prev.map((l) => {
        if (l.product.id !== id) return l;
        const next: CartLine = { ...l };
        if (patch.unitPrice !== undefined) {
          next.unitPrice =
            patch.unitPrice !== undefined && patch.unitPrice > 0
              ? patch.unitPrice
              : undefined;
        }
        if (patch.lineDiscount !== undefined) {
          const d = patch.lineDiscount;
          next.lineDiscount =
            d !== undefined && d > 0 ? Math.min(d, lineSubtotal(l)) : undefined;
        }
        return next;
      })
    );
  }

  function clearCart() {
    if (cart.length === 0) {
      toast("The cart is already empty", "info");
      return;
    }
    const ok = window.confirm(
      "Clear the current cart? This cannot be undone."
    );
    if (!ok) return;
    setCart([]);
    setImeis({});
    clearDraft();
  }

  function holdCart() {
    if (cart.length === 0) return;
    const order = createParkedOrder({
      lines: cart.map((l) => ({
        product_id: l.product.id,
        name: l.product.name,
        price: l.product.price,
        qty: l.qty,
        imeis: l.product.track_imei ? (imeis[l.product.id] ?? []) : [],
        unitPrice: l.unitPrice,
        lineDiscount: l.lineDiscount,
        sku: l.product.sku ?? null,
        barcode: l.product.barcode ?? null,
      })),
      discount,
      tax,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      cashier: user?.full_name ?? user?.username ?? null,
    });
    setParked((prev) => [order, ...prev]);
    toast(`Invoice held as ${order.holdNumber} — you can resume it anytime`, "info");
    setCart([]);
    setImeis({});
    setCustomer(null);
    setDiscount(0);
    setTax(0);
    setPointsUsed(0);
    setPayOpen(false);
    setMobileCartOpen(false);
    clearDraft();
  }

  function restoreParkedOrder(order: ParkedOrder) {
    const restored = buildCartFromLines(order.lines);
    if (restored.length === 0) {
      toast("Some parked items are no longer available", "error");
      return;
    }
    setCart(restored);
    setDiscount(order.discount ?? 0);
    setTax(order.tax ?? 0);
    const customerFound = customers.find((c) => c.id === order.customerId);
    if (customerFound) selectCustomer(customerFound);
    setParked((prev) => removeParked(prev, order.id));
    setParkedOpen(false);
    clearDraft();
    toast(`Held invoice ${order.holdNumber} restored`, "success");
  }

  function resumeDraft(draft: DraftOrder) {
    const restored = buildCartFromLines(draft.lines);
    if (restored.length === 0) {
      toast("Draft items are no longer available", "error");
      setRecoveredDraft(null);
      clearDraft();
      return;
    }
    setCart(restored);
    setDiscount(draft.discount ?? 0);
    setTax(draft.tax ?? 0);
    const customerFound = customers.find((c) => c.id === draft.customerId);
    if (customerFound) selectCustomer(customerFound);
    setPointsUsed(draft.pointsUsed ?? 0);
    setMethod(draft.method ?? "cash");
    setRecoveredDraft(null);
    clearDraft();
    toast("Recovered your draft invoice", "success");
  }

  function discardDraft() {
    setRecoveredDraft(null);
    clearDraft();
  }

  useEffect(() => {
    const draft = loadDraft();
    if (draft && Array.isArray(draft.lines) && draft.lines.length > 0) {
      setRecoveredDraft(draft);
    }
  }, []);

  useEffect(() => {
    if (cart.length === 0) return;
    const t = setTimeout(() => {
      saveDraft({
        lines: cart.map((l) => ({
          product_id: l.product.id,
          name: l.product.name,
          price: l.product.price,
          qty: l.qty,
          imeis: l.product.track_imei ? (imeis[l.product.id] ?? []) : [],
          unitPrice: l.unitPrice,
          lineDiscount: l.lineDiscount,
          sku: l.product.sku ?? null,
          barcode: l.product.barcode ?? null,
        })),
        discount,
        tax,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        pointsUsed: effectivePoints,
        method,
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, discount, tax, customer, effectivePoints, method, imeis]);

  useEffect(() => {
    setImeis((prev) => {
      const next: Record<number, string[]> = {};
      let changed = false;
      cart.forEach((l) => {
        if (!l.product.track_imei) return;
        const arr = prev[l.product.id] ?? [];
        const trimmed = arr.slice(0, l.qty);
        next[l.product.id] = trimmed;
        if (trimmed.length !== arr.length) changed = true;
      });
      if (Object.keys(next).length !== Object.keys(prev).length) changed = true;
      return changed ? next : prev;
    });
  }, [cart]);

  const imeiLines = useMemo(
    () =>
      cart
        .filter((l) => l.product.track_imei)
        .map((l) => ({
          product_id: l.product.id,
          name: l.product.name,
          qty: l.qty,
        })),
    [cart]
  );

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  const holdRef = useRef(holdCart);
  holdRef.current = holdCart;
  const cartLenRef = useRef(cart.length);
  cartLenRef.current = cart.length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA";

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      switch (e.key) {
        case "F1":
          e.preventDefault();
          setHelpOpen((o) => !o);
          break;
        case "F2":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "F3":
          e.preventDefault();
          scanRef.current?.focus();
          break;
        case "F4":
          e.preventDefault();
          customerSelectRef.current?.focus();
          break;
        case "F6":
          e.preventDefault();
          if (cartLenRef.current > 0) holdRef.current();
          break;
        case "F7":
          e.preventDefault();
          setParkedOpen(true);
          break;
        case "F8":
          e.preventDefault();
          if (cartLenRef.current > 0) setPayOpen(true);
          break;
        case "F9":
          e.preventDefault();
          router.push("/transactions");
          break;
        case "F10":
          e.preventDefault();
          router.push("/sales?return=1");
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  async function confirmSale(paid: number, payments?: SplitLine[]) {
    if (submittingRef.current) return;
    const problems = invalidCartLines(cart, (id) => stockById[id]);
    if (problems.length > 0) {
      const p = problems[0];
      toast(
        `${stockWarningMessage(p.line.product.name, p.issue)} Adjust quantities before completing.`,
        "error"
      );
      setPayOpen(false);
      setMobileCartOpen(false);
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    const payload = {
      items: cart.map((l) => ({
        product_id: l.product.id,
        qty: l.qty,
        price: l.unitPrice ?? undefined,
        imeis: l.product.track_imei
          ? (imeis[l.product.id] ?? [])
              .map((v) => v.trim())
              .filter(Boolean)
              .slice(0, l.qty)
          : undefined,
      })),
      customer_id: customer?.id ?? null,
      discount_amount: discountTotal,
      tax_amount: tax,
      paid_amount: payments ? undefined : paid,
      payment_method: payments ? undefined : method,
      payments,
      loyalty_points_used: effectivePoints,
    };
    const collected = payments
      ? payments.reduce((s, p) => s + p.amount, 0)
      : paid;

    if (offline) {
      const entry = enqueueSale(payload);
      setPendingQueue(loadQueue());
      cart.forEach((l) => applyOptimisticStock(l.product.id, l.qty));
      setReceipt({
        id: entry.id,
        lines: cart,
        subtotal,
        discount: discountTotal,
        tax,
        pointsUsed: effectivePoints,
        total,
        paid: collected,
        due: Math.max(0, total - collected),
        change: payments ? 0 : paid > total ? paid - total : 0,
        method: payments && payments.length > 1 ? "split" : method,
        payments,
        offline: true,
        customer: customer?.name ?? null,
      });
      resetAfterSale();
      toast("Sale saved offline — will sync when back online", "info");
      setBusy(false);
      submittingRef.current = false;
      return;
    }

    try {
      const sale = await api.sales.create(payload);
      cart.forEach((l) => applyOptimisticStock(l.product.id, l.qty));
      setReceipt({
        id: sale.id,
        lines: cart,
        subtotal,
        discount: discountTotal,
        tax,
        pointsUsed: effectivePoints,
        total,
        paid: collected,
        due: Math.max(0, total - collected),
        change: payments ? 0 : paid > total ? paid - total : 0,
        method: payments && payments.length > 1 ? "split" : method,
        payments,
        customer: customer?.name ?? null,
      });
      resetAfterSale();
      toast(
        customer
          ? `Sale completed — ${formatMoney(collected)} collected, ${formatMoney(
              Math.max(0, total - collected)
            )} on credit`
          : "Sale completed — stock updated",
        "success"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sale failed";
      toast(msg, "error");
      setPayOpen(false);
      setMobileCartOpen(false);
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }

  function resetAfterSale() {
    setCart([]);
    setImeis({});
    setCustomer(null);
    setDiscount(0);
    setTax(0);
    setPointsUsed(0);
    setMethod("cash");
    setPayOpen(false);
    setMobileCartOpen(false);
    clearDraft();
  }

  async function quickCash() {
    if (
      cart.length === 0 ||
      imeiLines.length > 0 ||
      busy ||
      submittingRef.current
    )
      return;
    const problems = invalidCartLines(cart, (id) => stockById[id]);
    if (problems.length > 0) {
      toast(
        "Some quantities exceed stock — fix them before quick cash",
        "error"
      );
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    const paid = total;
    const payload = {
      items: cart.map((l) => ({
        product_id: l.product.id,
        qty: l.qty,
        price: l.unitPrice ?? undefined,
      })),
      customer_id: null,
      discount_amount: discountTotal,
      tax_amount: 0,
      paid_amount: paid,
      payment_method: "cash",
      loyalty_points_used: 0,
    };

    if (offline) {
      const entry = enqueueSale(payload);
      setPendingQueue(loadQueue());
      cart.forEach((l) => applyOptimisticStock(l.product.id, l.qty));
      setReceipt({
        id: entry.id,
        lines: cart,
        subtotal: paid,
        discount: 0,
        tax: 0,
        pointsUsed: 0,
        total: paid,
        paid,
        due: 0,
        change: 0,
        method: "cash",
        offline: true,
        customer: null,
      });
      resetAfterSale();
      toast("Sale saved offline — will sync when back online", "info");
      setBusy(false);
      submittingRef.current = false;
      return;
    }

    try {
      const sale = await api.sales.create(payload);
      cart.forEach((l) => applyOptimisticStock(l.product.id, l.qty));
      setReceipt({
        id: sale.id,
        lines: cart,
        subtotal: paid,
        discount: 0,
        tax: 0,
        pointsUsed: 0,
        total: paid,
        paid,
        due: 0,
        change: 0,
        method: "cash",
        customer: null,
      });
      resetAfterSale();
      toast("Sale completed — exact cash", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Sale failed", "error");
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }

  const hasOverrides = cart.some((l) => l.unitPrice !== undefined || l.lineDiscount);
  const quickCashEnabled =
    cart.length > 0 &&
    !cartInvalid &&
    imeiLines.length === 0 &&
    !customer &&
    discount === 0 &&
    tax === 0 &&
    effectivePoints === 0 &&
    !hasOverrides &&
    !busy;

  const cartSummary =
    discountTotal > 0 || tax > 0 || effectivePoints > 0 ? (
      <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-500">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatMoney(subtotal)}</span>
        </div>
        {lineDiscounts > 0 && (
          <div className="flex justify-between text-emerald-600">
            <span>Line discounts</span>
            <span>−{formatMoney(lineDiscounts)}</span>
          </div>
        )}
        {discount > 0 && (
          <div className="flex justify-between text-emerald-600">
            <span>Discount</span>
            <span>−{formatMoney(discount)}</span>
          </div>
        )}
        {tax > 0 && (
          <div className="flex justify-between">
            <span>Tax</span>
            <span>+{formatMoney(tax)}</span>
          </div>
        )}
        {effectivePoints > 0 && (
          <div className="flex justify-between text-amber-600">
            <span>Loyalty points</span>
            <span>−{formatMoney(effectivePoints)}</span>
          </div>
        )}
      </div>
    ) : null;

  const cartPanelProps = {
    lines: cart,
    total,
    itemCount,
    summary: cartSummary,
    connected,
    busy,
    onAdd: increment,
    onRemove: decrement,
    onSetQty: setQty,
    onQuickAdd: quickAdd,
    onLineChange: changeLine,
    onClear: clearCart,
    onCheckout: () => {
      if (cartInvalid) {
        toast(
          "Some quantities exceed stock — fix them before checkout",
          "error"
        );
        return;
      }
      setPayOpen(true);
    },
    onQuickCash: quickCash,
    quickCashEnabled,
    onHold: holdCart,
    parkedCount: parked.length,
    onParked: () => setParkedOpen(true),
    stockById,
    onSetToAvailable: setToAvailable,
    onRemoveLine: removeLine,
  };

  const filteredParked = useMemo(() => {
    const q = parkedSearch.trim().toLowerCase();
    if (!q) return parked;
    return parked.filter(
      (o) =>
        o.holdNumber.toLowerCase().includes(q) ||
        (o.customerName ?? "").toLowerCase().includes(q) ||
        o.lines.some((l) => l.name.toLowerCase().includes(q))
    );
  }, [parked, parkedSearch]);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Point of Sale"
        subtitle={new Date().toLocaleDateString("en-LK", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge bg-white text-slate-500 ring-1 ring-slate-200">
            {products.length} products on shelf
          </span>
          <button
            onClick={() => router.push("/transactions")}
            className="badge bg-white text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50"
            title="Transaction history (F9)"
          >
            🧾 History
          </button>
          <button
            onClick={() => router.push("/sales?return=1")}
            className="badge bg-white text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50"
            title="Sales returns (F10)"
          >
            ↩️ Returns
          </button>
          <button
            onClick={() => setHelpOpen(true)}
            className="badge bg-slate-900 text-white"
            title="Keyboard shortcuts (F1)"
          >
            ⌨️ Shortcuts
          </button>
        </div>
      </PageHeader>

      {offline && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          <span>📡 Offline mode — using the saved product catalog.</span>
          <span className="font-bold">
            Sales will be queued{pendingQueue.length > 0 ? ` (${pendingQueue.length} queued)` : ""} and synced automatically.
          </span>
        </div>
      )}
      {!offline && pendingQueue.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <span>✅ Back online.</span>
          <button
            onClick={flushQueue}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-emerald-700"
          >
            Sync {pendingQueue.length} queued sale{pendingQueue.length > 1 ? "s" : ""}
          </button>
        </div>
      )}

      {recoveredDraft && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800">
          <span>
            💾 Recovered your unfinished invoice from{" "}
            {new Date(recoveredDraft.savedAt).toLocaleTimeString("en-LK", {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            ({recoveredDraft.lines.length} item
            {recoveredDraft.lines.length > 1 ? "s" : ""}).
          </span>
          <button
            onClick={() => resumeDraft(recoveredDraft)}
            className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-sky-700"
          >
            Resume
          </button>
          <button
            onClick={discardDraft}
            className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-200 transition hover:bg-sky-100"
          >
            Discard
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section>
          <div className="mb-4 flex flex-col gap-3">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative flex-1 md:flex-[2]">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7V4h3" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 17v3h3" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7V4h-3" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 17v3h-3" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h1" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9h1" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 9h1" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h1" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 12h1" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 12h1" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 15h1" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15h1" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 15h1" />
                  </svg>
                </span>
                <input
                  ref={scanRef}
                  value={scanInput}
                  onChange={(e) => {
                    setScanInput(e.target.value);
                    setScanResults([]);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleScan(scanInput);
                    }
                  }}
                  placeholder="Scan barcode / SKU — or type a name, press Enter"
                  className="input pl-11 font-mono"
                />
                {scanResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
                    <p className="bg-slate-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                      Multiple matches — pick one
                    </p>
                    {scanResults.map((m) => (
                      <button
                        key={m.product.id}
                        onClick={() => {
                          addToCartQty(m.product as Product, 1);
                          setScanResults([]);
                          scanRef.current?.focus();
                        }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-slate-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">
                            {m.product.name}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-slate-400">
                            {m.product.sku ?? m.product.barcode ?? m.field}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-bold text-emerald-600">
                            {formatMoney(m.product.price)}
                          </span>
                          <span className="block text-[10px] text-slate-400">
                            {m.product.stock} in stock
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
                  </svg>
                </span>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearchSubmit();
                    }
                  }}
                  placeholder="Search by name, SKU or barcode — or type a command…"
                  className="input pl-11 pr-11"
                />
                {voice.supported && (
                  <button
                    onClick={() => {
                      if (voice.state.status === "listening") {
                        voice.stop();
                      } else {
                        voiceDispatchedRef.current = false;
                        voice.start();
                      }
                    }}
                    title={
                      voice.state.status === "listening"
                        ? "Stop listening"
                        : "Speak a command — no wake word needed"
                    }
                    aria-label={
                      voice.state.status === "listening"
                        ? "Stop listening"
                        : "Speak a command"
                    }
                    className={`absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg transition ${
                      voice.state.status === "listening"
                        ? "animate-pulse bg-red-500 text-white shadow-md"
                        : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    }`}
                  >
                    {voice.state.status === "processing" ? (
                      <svg
                        className="h-4 w-4 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 10v2a7 7 0 0 1-14 0v-2"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 19v4"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 23h8"
                        />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition ${
                      category === c
                        ? "bg-slate-900 text-white shadow-md"
                        : "bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {c !== "All" && <span>{categoryIcon(c)}</span>}
                    {c}
                  </button>
                ))}
              </div>
              <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-slate-500">
                <span className="hidden sm:inline">Customer</span>
                <select
                  ref={customerSelectRef}
                  value={customer?.id ?? ""}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    selectCustomer(
                      id ? customers.find((c) => c.id === id) ?? null : null
                    );
                  }}
                  className="select !w-auto max-w-[180px] !py-1.5 text-xs"
                  title="Select customer (F4)"
                >
                  <option value="">Walk-in</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {gridItems.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="No products match"
              hint="Try a different search, SKU, barcode or category."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {gridItems.map((m) => {
                const p = m.product as Product;
                const tone = stockTone(p.stock);
                const nameRanges =
                  m.field === "name" || m.field === "model" ? m.ranges : [];
                const codeRanges =
                  m.field === "sku" || m.field === "barcode" ? m.ranges : [];
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    disabled={p.stock <= 0}
                    className={`group relative flex flex-col overflow-hidden rounded-2xl bg-white p-3.5 text-left shadow-soft ring-1 ring-slate-100 transition ${
                      p.stock <= 0
                        ? "cursor-not-allowed opacity-50"
                        : "hover:-translate-y-0.5 hover:shadow-card active:scale-95"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="h-11 w-11 rounded-xl bg-slate-100 object-cover"
                        />
                      ) : (
                        <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-2xl transition group-hover:scale-105">
                          {categoryIcon(p.category)}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          p.stock <= 0
                            ? "bg-red-500 text-white"
                            : p.stock <= 5
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {tone.label}
                      </span>
                    </div>
                    <h3 className="mt-3 truncate text-sm font-bold">
                      <Highlighted text={p.name} ranges={nameRanges} />
                    </h3>
                    {(p.sku || p.barcode) && (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                        <Highlighted
                          text={p.sku ?? p.barcode ?? ""}
                          ranges={codeRanges}
                        />
                      </p>
                    )}
                    <p className="text-[11px] font-medium text-slate-400">
                      {p.category}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-base font-bold text-emerald-600">
                        {formatMoney(p.price)}
                      </span>
                      {p.stock > 0 && (
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-xs font-bold text-white opacity-0 transition group-hover:opacity-100">
                          +
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="hidden lg:block">
          <div className="sticky top-24 flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-2xl bg-white p-4 shadow-soft ring-1 ring-slate-100">
            <CartPanel {...cartPanelProps} />
          </div>
        </aside>
      </div>

      {itemCount > 0 && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="fixed bottom-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-xl shadow-slate-300 transition active:scale-95 lg:hidden"
        >
          <span className="relative">
            🛒
            <span className="absolute -right-2.5 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold">
              {itemCount}
            </span>
          </span>
          View cart · {formatMoney(total)}
        </button>
      )}

      <Modal
        open={mobileCartOpen}
        onClose={() => setMobileCartOpen(false)}
        title="Current order"
      >
        <div className="flex max-h-[70dvh] flex-col overflow-hidden">
          <CartPanel {...cartPanelProps} />
        </div>
      </Modal>

      <CheckoutModal
        open={payOpen}
        busy={busy}
        onClose={() => setPayOpen(false)}
        subtotal={subtotal}
        discount={discountTotal}
        tax={tax}
        pointsUsed={effectivePoints}
        total={total}
        customer={customer}
        customers={customers}
        method={method}
        imeiLines={imeiLines}
        imeis={imeis}
        onImeiChange={(productId, values) =>
          setImeis((prev) => ({ ...prev, [productId]: values }))
        }
        onCustomerChange={selectCustomer}
        onDiscountChange={setDiscount}
        onTaxChange={setTax}
        onPointsChange={setPointsUsed}
        onMethodChange={setMethod}
        onConfirm={confirmSale}
      />

      <Modal
        open={parkedOpen}
        onClose={() => setParkedOpen(false)}
        title="Held invoices"
      >
        <input
          value={parkedSearch}
          onChange={(e) => setParkedSearch(e.target.value)}
          placeholder="Search held invoices by number, customer or product…"
          className="input mb-3"
        />
        {filteredParked.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            {parkedSearch
              ? "No held invoices match your search."
              : "No held invoices. Use Hold in the cart to save one."}
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {filteredParked.map((o) => (
              <div
                key={o.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
                      <span className="rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                        {o.holdNumber}
                      </span>
                      {o.label}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(o.createdAt).toLocaleString("en-LK", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                      {o.customerName ? ` · ${o.customerName}` : " · Walk-in"}
                      {o.cashier ? ` · 👤 ${o.cashier}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold text-emerald-600">
                      {formatMoney(
                        o.lines.reduce((s, l) => s + parkedLineTotal(l), 0) -
                          (o.discount ?? 0)
                      )}
                    </p>
                    <p className="text-[10px] font-medium text-slate-400">
                      {o.lines.length} product{o.lines.length > 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <p className="mt-1.5 text-xs font-medium text-slate-500">
                  {o.lines.map((l) => `${l.name} ×${l.qty}`).join(", ")}
                </p>
                <input
                  value={o.note ?? ""}
                  onChange={(e) =>
                    setParked((prev) =>
                      updateParkedNote(prev, o.id, e.target.value)
                    )
                  }
                  placeholder="Add a note for this held invoice…"
                  className="mt-2 h-8 w-full rounded-lg border-0 bg-slate-50 px-2.5 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => restoreParkedOrder(o)}
                    className="btn btn-primary flex-1 py-1.5 text-xs"
                  >
                    Resume
                  </button>
                  <button
                    onClick={() => {
                      const ok = window.confirm(
                        `Delete held invoice ${o.holdNumber}?`
                      );
                      if (ok)
                        setParked((prev) => removeParked(prev, o.id));
                    }}
                    className="btn btn-danger flex-1 py-1.5 text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={!!pickProduct}
        onClose={() => setPickProduct(null)}
        title="Which product did you mean?"
        maxWidth="max-w-md"
      >
        {pickProduct && (
          <div className="space-y-2">
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <span className="font-bold">For “{pickProduct.term}”</span>
              {pickProduct.qty > 1 && (
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                  qty {pickProduct.qty}
                </span>
              )}
            </p>
            {pickProduct.matches.map((m) => (
              <button
                key={m.product.id}
                onClick={() => {
                  const p = m.product as Product;
                  if (pickProduct.on === "add") {
                    addToCartQty(p, pickProduct.qty);
                    toast(`Added ${pickProduct.qty} × "${p.name}"`, "success");
                  } else if (pickProduct.on === "remove") {
                    const line = cart.find((l) => l.product.id === p.id);
                    if (line) removeLine(p.id);
                    else toast(`"${p.name}" is not in the cart`, "info");
                  } else if (pickProduct.on === "stock") {
                    toast(`"${p.name}" has ${p.stock} in stock`, "success");
                  } else if (pickProduct.on === "return") {
                    router.push("/sales?return=1");
                  } else {
                    const line = cart.find((l) => l.product.id === p.id);
                    if (line) {
                      setQty(p.id, pickProduct.qty);
                      toast(`"${p.name}" set to ${pickProduct.qty}`, "success");
                    } else {
                      toast(`"${p.name}" is not in the cart`, "info");
                    }
                  }
                  setPickProduct(null);
                  searchRef.current?.focus();
                }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {m.product.name}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-slate-400">
                    {m.product.sku ?? m.product.barcode ?? m.field}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold text-emerald-600">
                    {formatMoney(m.product.price)}
                  </span>
                  <span className="block text-[10px] text-slate-400">
                    {m.product.stock} in stock
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={!!nlConfirm}
        onClose={() => setNlConfirm(null)}
        title="Confirm"
        maxWidth="max-w-md"
      >
        <p className="text-sm font-semibold text-slate-700">
          {nlConfirm?.message}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => {
              const run = nlConfirm?.run;
              setNlConfirm(null);
              run?.();
            }}
            className="btn btn-danger flex-1"
          >
            Confirm
          </button>
          <button
            onClick={() => setNlConfirm(null)}
            className="btn btn-secondary flex-1"
          >
            Cancel
          </button>
        </div>
      </Modal>

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Keyboard shortcuts"
        maxWidth="max-w-md"
      >
        <div className="divide-y divide-slate-100">
          {SHORTCUTS.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between gap-4 py-2.5"
            >
              <kbd className="shrink-0 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                {s.key}
              </kbd>
              <span className="text-sm text-slate-600">{s.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400">
          In the search box you can type plain commands — e.g. “add 3 Pepsi”,
          “hold invoice”, “clear the cart”, “checkout”, “who was the customer
          for invoice 1025”, or “customer returned 2 chargers”. Press Enter to
          run them. Or press the 🎤 button beside the search box and just say
          the same thing naturally — no wake word needed. Shortcuts never
          block typing or scanning.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Stock safety: you can never be charged more than what is in stock —
          over-limit quantities show a warning with “Set to available” and
          checkout is blocked until fixed.
        </p>
      </Modal>

      {receipt && (
        <ReceiptModal
          open={!!receipt}
          saleId={receipt.id}
          lines={receipt.lines}
          subtotal={receipt.subtotal}
          discount={receipt.discount}
          tax={receipt.tax}
          pointsUsed={receipt.pointsUsed}
          total={receipt.total}
          paid={receipt.paid}
          due={receipt.due}
          change={receipt.change}
          method={receipt.method}
          payments={receipt.payments}
          offline={receipt.offline}
          customer={receipt.customer}
          cashier={user?.full_name ?? user?.username ?? ""}
          receiptFooter={printSettings.receipt_footer ?? ""}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}
