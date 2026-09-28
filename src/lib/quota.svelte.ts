import type { QuotaReport } from "../../worker/quota.ts";
import { trackedFetch } from "./feed-log.svelte";
import { startPoll } from "./poller";

// Each check is one Worker request, so a few an hour is plenty.
export const QUOTA_POLL_MS = 5 * 60_000;

export class QuotaMeter {
  report = $state<QuotaReport | null>(null);
  error = $state<string | null>(null);
  stopPoll: (() => void) | null = null;

  async refresh() {
    try {
      const res = await trackedFetch("/api/quota");
      const body = (await res.json().catch(() => ({}))) as Partial<QuotaReport> & {
        error?: string;
      };
      if (!res.ok) {
        this.error = body.error ?? `Usage unavailable (${res.status})`;
        return;
      }
      this.report = body as QuotaReport;
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Usage unavailable";
    }
  }

  start() {
    if (this.stopPoll) return;
    this.stopPoll = startPoll(() => void this.refresh(), QUOTA_POLL_MS);
  }

  stop() {
    this.stopPoll?.();
    this.stopPoll = null;
  }
}

export const quota = new QuotaMeter();
