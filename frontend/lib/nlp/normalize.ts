/**
 * Light text normalization for natural-language POS input.
 * Lowercases, expands contractions, fixes common typos, collapses
 * punctuation and strips leading pleasantries — without ever touching
 * product names (that is handled separately in the engine).
 */

const CONTRACTION_FIXES: [RegExp, string][] = [
  [/don't/g, "do not"],
  [/can't/g, "can not"],
  [/won't/g, "will not"],
  [/i'm/g, "i am"],
  [/i've/g, "i have"],
  [/what's/g, "what is"],
  [/who's/g, "who is"],
  [/where's/g, "where is"],
  [/how's/g, "how is"],
  [/there's/g, "there is"],
  [/that's/g, "that is"],
  [/it's/g, "it is"],
  [/didn't/g, "did not"],
  [/isn't/g, "is not"],
  [/aren't/g, "are not"],
  [/wasn't/g, "was not"],
  [/weren't/g, "were not"],
  [/you're/g, "you are"],
  [/we're/g, "we are"],
  [/they're/g, "they are"],
];

const RUN_TOGETHER_FIXES: Record<string, string> = {
  showme: "show me",
  howmany: "how many",
  howmuch: "how much",
  ineed: "i need",
  iwant: "i want",
  addone: "add one",
  addme: "add me",
  gimme: "give me",
  whats: "what is",
  whos: "who is",
  wheres: "where is",
  hows: "how is",
  dont: "do not",
  cant: "can not",
  im: "i am",
  invice: "invoice",
  invocie: "invoice",
  invoce: "invoice",
  invoic: "invoice",
  invoise: "invoice",
  reciept: "receipt",
  recpt: "receipt",
  qty: "quantity",
  thanx: "thank you",
  thx: "thank you",
  ok: "",
  okay: "",
  pls: "please",
  plz: "please",
  wanna: "want to",
  gonna: "going to",
  addd: "add",
  adddd: "add",
  seach: "search",
  serach: "search",
  chekout: "checkout",
  checkot: "checkout",
  removee: "remove",
  holdd: "hold",
  cancle: "cancel",
  pya: "pay",
  pritn: "print",
  prnt: "print",
  findd: "find",
  lookk: "look",
  showw: "show",
  clearr: "clear",
};

const PLEASANTRIES = [
  "please",
  "kindly",
  "hey",
  "hi",
  "hello",
  "yo",
];

export function normalizeText(raw: string): string {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/[\u2019\u2018]/g, "'");
  for (const [re, rep] of CONTRACTION_FIXES) s = s.replace(re, rep);
  s = s.replace(/[.,;:!?()\[\]{}\/\\<>"“”‘’`~=+*^|]+/g, " ");
  s = s.replace(/[–—_-]+/g, " ").replace(/\s+/g, " ").trim();
  const tokens = s.split(" ");
  const fixed = tokens.map((tok) => RUN_TOGETHER_FIXES[tok] ?? tok);
  s = fixed.join(" ").replace(/\s+/g, " ").trim();
  const parts = s.split(" ");
  const cleaned: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (PLEASANTRIES.includes(part) && cleaned.length === 0) continue;
    cleaned.push(part);
  }
  return cleaned.join(" ");
}

/** Levenshtein distance between two strings (used for command typo fixes). */
export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[lb];
}
