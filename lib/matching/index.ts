import { decimal, Quantity } from "../inventory/math";

export function normalizeName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export interface MatchCandidate { name: string; brand?: string; bottleSizeMl?: Quantity }
export interface MatchProduct { id: string; name: string; brand?: string; bottleSizeMl: Quantity; normalizedName?: string }
export interface MatchAlias { productId: string; normalizedName: string; bottleSizeMl: Quantity }
export interface ProductMatch<T extends MatchProduct = MatchProduct> {
  product: T; productId: string; score: number; confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: "ALIAS" | "EXACT" | "BRAND" | "FUZZY" | "SIZE_MISMATCH"; sizeMismatch: boolean;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = next;
  }
  const edit = 1 - previous[b.length] / Math.max(a.length, b.length);
  const left = new Set(a.split(" ")), right = new Set(b.split(" "));
  const overlap = [...left].filter(token => right.has(token)).length;
  return Math.max(edit, (2 * overlap) / (left.size + right.size));
}

function extractCandidate(value: string | MatchCandidate): MatchCandidate {
  const candidate = typeof value === "string" ? { name: value } : { ...value };
  const size = /\b(\d+(?:\.\d+)?)\s*(ml|cl|l|liters?|litres?)\b/i.exec(candidate.name);
  if (size) {
    const factor = size[2].toLowerCase() === "ml" ? "1" : size[2].toLowerCase() === "cl" ? "10" : "1000";
    candidate.bottleSizeMl ??= decimal(size[1]).mul(factor).toFixed();
    candidate.name = candidate.name.replace(size[0], " ").trim();
  }
  return candidate;
}

/** Stable ties break by product id, independent of database/input ordering. */
export function matchProducts<T extends MatchProduct>(candidateInput: string | MatchCandidate, products: T[], aliases: MatchAlias[] = []): ProductMatch<T> | null {
  const candidate = extractCandidate(candidateInput);
  const name = normalizeName(candidate.name);
  if (!name) return null;
  const brand = normalizeName(candidate.brand ?? "");
  if (candidate.bottleSizeMl !== undefined && !decimal(candidate.bottleSizeMl).gt(0)) throw new Error("Candidate bottle size must be positive");
  const ranked = products.map(product => {
    const target = normalizeName(extractCandidate({ name: product.name }).name);
    const targetBrand = normalizeName(product.brand ?? "");
    const sizeMismatch = candidate.bottleSizeMl !== undefined && !decimal(candidate.bottleSizeMl).eq(decimal(product.bottleSizeMl));
    // An explicit alias may only be applied with a known, matching size.
    const alias = candidate.bottleSizeMl !== undefined && aliases.some(item => item.productId === product.id
      && normalizeName(item.normalizedName) === name && decimal(item.bottleSizeMl).eq(decimal(candidate.bottleSizeMl!))
      && decimal(item.bottleSizeMl).eq(decimal(product.bottleSizeMl)));
    let reason: ProductMatch<T>["reason"] = "FUZZY";
    let score = similarity(name, target) * 0.84;
    if (alias) { score = 1; reason = "ALIAS"; }
    else if (name === target) { score = 0.98; reason = "EXACT"; }
    else if (targetBrand && (brand === targetBrand || name === normalizeName(`${targetBrand} ${target}`))) {
      score = Math.max(score, name === normalizeName(`${targetBrand} ${target}`) ? 0.96 : 0.65 + similarity(name, target) * 0.24);
      reason = "BRAND";
    }
    if (sizeMismatch) { score = Math.min(score, 0.49); reason = "SIZE_MISMATCH"; }
    score = Math.round(score * 10000) / 10000;
    const confidence: ProductMatch<T>["confidence"] = score >= 0.9 ? "HIGH" : score >= 0.65 ? "MEDIUM" : "LOW";
    return { product, productId: product.id, score, confidence, reason, sizeMismatch };
  });
  ranked.sort((a, b) => b.score - a.score || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
  return ranked[0] ?? null;
}

export const productMatchingService = { normalizeName, matchProducts };