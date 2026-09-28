import {
  ALERT_COOLDOWN_MS,
  DEFAULT_ASSETS,
  MOOD_POLL_MS,
  POLL_MS,
  STORAGE_KEY,
} from "./assets";
import { formatPct, formatPrice } from "./format";
import { fetchFearGreed } from "./fear-greed";
import { fetchAllQuotes } from "./quotes";
import { appendQuoteTick, loadDesk, mergeTicks, saveDesk, uid } from "./storage";
import type {
  AlertEvent,
  AlertKind,
  AlertRule,
  Asset,
  DeskState,
  FearGreedState,
  Quote,
  Tick,
} from "./types";
import { playTripChime } from "./chime";
import { startPoll } from "./poller";
import { findOnDesk, sameAsset } from "./watchlist";

function evaluate(
  quote: Quote,
  rules: AlertRule[],
  assets: Asset[],
): { rules: AlertRule[]; events: AlertEvent[] } {
  const now = Date.now();
  const events: AlertEvent[] = [];
  const next = rules.map((rule) => {
    if (!rule.enabled || rule.assetId !== quote.id) return rule;
    if (rule.lastFiredAt && now - rule.lastFiredAt < ALERT_COOLDOWN_MS) return rule;
    const asset = assets.find((a) => a.id === quote.id);
    const symbol = asset?.symbol ?? quote.id.toUpperCase();
    let tripped = false;
    let message = "";
    if (rule.kind === "above" && quote.price >= rule.value) {
      tripped = true;
      message = `${symbol} printed $${formatPrice(quote.price)} — above ${formatPrice(rule.value)}`;
    } else if (rule.kind === "below" && quote.price <= rule.value) {
      tripped = true;
      message = `${symbol} printed $${formatPrice(quote.price)} — below ${formatPrice(rule.value)}`;
    } else if (rule.kind === "move" && Math.abs(quote.changePct) >= rule.value) {
      tripped = true;
      message = `${symbol} is ${formatPct(quote.changePct)} on the session — ${rule.value}% trip`;
    }
    if (!tripped) return rule;
    events.push({
      id: uid(),
      ruleId: rule.id,
      assetId: quote.id,
      message,
      at: now,
      price: quote.price,
    });
    return { ...rule, lastFiredAt: now };
  });
  return { rules: next, events };
}

function notifyBrowser(event: AlertEvent) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification("Lookout", { body: event.message });
  } catch {
    // Safari private / denied after the check.
  }
}

export class Desk {
  quotes = $state<Record<string, Quote>>({});
  ticks = $state<Record<string, Tick[]>>({});
  rules = $state<AlertRule[]>([]);
  events = $state<AlertEvent[]>([]);
  focusId = $state("btc");
  assets = $state<Asset[]>([]);
  saved = $state<boolean | null>(null);
  status = $state<"live" | "error" | "idle">("idle");
  errors = $state<string[]>([]);
  updatedAt = $state<number | null>(null);
  flashed = $state<Record<string, number>>({});
  mood = $state<FearGreedState>({
    crypto: null,
    stocks: null,
    errors: [],
    updatedAt: null,
  });
  seeded = false;
  stopPolls: (() => void) | null = null;

  constructor() {
    this.restore(loadDesk());
  }

  restore(initial: DeskState) {
    this.quotes = initial.quotes;
    this.ticks = initial.ticks;
    this.rules = initial.rules;
    this.events = initial.events;
    this.focusId = initial.focusId;
    this.assets = initial.assets;
    this.updatedAt = Object.values(initial.quotes)[0]?.asOf ?? null;
    if (!this.assets.length) {
      this.status = "idle";
      this.errors = [];
    }
  }

  persist() {
    this.saved = saveDesk({
      quotes: this.quotes,
      ticks: this.ticks,
      rules: this.rules,
      events: this.events,
      focusId: this.focusId,
      assets: this.assets,
    });
  }

  onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    this.restore(loadDesk());
    this.saved = true;
  };

  applyBatch(batch: Awaited<ReturnType<typeof fetchAllQuotes>>) {
    const flash: Record<string, number> = {};
    const nextQuotes = { ...this.quotes };
    const nextTicks = { ...this.ticks };
    for (const quote of batch.quotes) {
      const prior = nextQuotes[quote.id];
      if (prior && prior.price !== quote.price) flash[quote.id] = Date.now();
      nextQuotes[quote.id] = quote;
      const seeded = mergeTicks(nextTicks[quote.id], batch.seeds[quote.id] ?? []);
      nextTicks[quote.id] = appendQuoteTick(seeded, quote);
    }
    this.quotes = nextQuotes;
    this.ticks = nextTicks;
    if (Object.keys(flash).length) {
      this.flashed = { ...this.flashed, ...flash };
    }

    let nextRules = this.rules;
    const fired: AlertEvent[] = [];
    for (const quote of batch.quotes) {
      const result = evaluate(quote, nextRules, this.assets);
      nextRules = result.rules;
      fired.push(...result.events);
    }
    this.rules = nextRules;
    if (fired.length) {
      this.events = [...fired, ...this.events].slice(0, 80);
      fired.forEach(notifyBrowser);
      playTripChime();
    }
    this.persist();
  }

  async pollMood() {
    try {
      this.mood = await fetchFearGreed();
    } catch (err) {
      this.mood = {
        crypto: this.mood.crypto,
        stocks: this.mood.stocks,
        errors: [err instanceof Error ? err.message : "Fear & greed failed"],
        updatedAt: this.mood.updatedAt,
      };
    }
  }

  async poll() {
    if (!this.assets.length) {
      this.status = "idle";
      this.errors = [];
      return;
    }
    try {
      const seed = !this.seeded;
      const batch = await fetchAllQuotes(this.assets, seed);
      if (!this.assets.length) return;
      if (seed && batch.quotes.length) this.seeded = true;
      if (!batch.quotes.length) {
        this.status = "error";
        this.errors = batch.errors.length ? batch.errors : ["No quotes returned"];
        return;
      }
      this.applyBatch(batch);
      this.updatedAt = Date.now();
      this.errors = batch.errors;
      this.status = "live";
    } catch (err) {
      this.status = "error";
      this.errors = [err instanceof Error ? err.message : "Poll failed"];
    }
  }

  start() {
    if (this.stopPolls) return;
    // Freeze the first-visit defaults (or legacy migration) even if feeds fail.
    this.persist();
    window.addEventListener("storage", this.onStorage);
    const stopQuotes = startPoll(() => void this.poll(), POLL_MS);
    const stopMood = startPoll(() => void this.pollMood(), MOOD_POLL_MS);
    this.stopPolls = () => {
      stopQuotes();
      stopMood();
    };
  }

  stop() {
    window.removeEventListener("storage", this.onStorage);
    this.stopPolls?.();
    this.stopPolls = null;
  }

  setFocus(id: string) {
    if (!this.assets.some((asset) => asset.id === id)) return;
    this.focusId = id;
    this.persist();
  }

  async addAsset(incoming: Asset) {
    const existing = findOnDesk(incoming, this.assets);
    if (existing) {
      this.setFocus(existing.id);
      return existing.id;
    }
    const asset = DEFAULT_ASSETS.find((d) => sameAsset(d, incoming)) ?? incoming;
    this.assets = [...this.assets, asset];
    this.focusId = asset.id;
    this.persist();
    try {
      const batch = await fetchAllQuotes([asset], true);
      this.applyBatch(batch);
      if (batch.quotes.length) this.updatedAt = Date.now();
    } catch {
      // Next poll will retry.
    }
    return asset.id;
  }

  removeAsset(id: string) {
    this.assets = this.assets.filter((a) => a.id !== id);
    if (this.focusId === id) {
      this.focusId = this.assets[0]?.id ?? "";
    }
    this.rules = this.rules.filter((r) => r.assetId !== id);
    if (!this.assets.length) {
      this.status = "idle";
      this.errors = [];
    }
    this.persist();
  }

  moveAsset(fromId: string, toId: string) {
    if (fromId === toId) return;
    const next = [...this.assets];
    const from = next.findIndex((asset) => asset.id === fromId);
    const to = next.findIndex((asset) => asset.id === toId);
    if (from < 0 || to < 0) return;
    const [asset] = next.splice(from, 1);
    next.splice(to, 0, asset);
    this.assets = next;
    this.persist();
  }

  addRule(assetId: string, kind: AlertKind, value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    this.rules = [...this.rules, { id: uid(), assetId, kind, value, enabled: true }];
    this.persist();
  }

  removeRule(id: string) {
    this.rules = this.rules.filter((r) => r.id !== id);
    this.persist();
  }

  clearEvents() {
    this.events = [];
    this.persist();
  }
}

export const desk = new Desk();
