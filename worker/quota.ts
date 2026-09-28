// Worker requests used today against the Workers Free plan's daily allowance.
// The allowance is per account and resets at midnight UTC, so this totals every
// Worker on the account since then. The Worker (worker/index.ts) and the Vite dev
// server (vite.config.ts) both answer /api/quota with quotaResponse().
// Its settings are ANALYTICS_TOKEN and ANALYTICS_ACCOUNT_ID, never CF_API_TOKEN or
// CF_ACCOUNT_ID: Wrangler reads those from .env.local as its own login.

export const DAILY_REQUESTS = 100_000;

// Must match "name" in wrangler.jsonc.
const SCRIPT = "lookout";

export type QuotaReport = {
  used: number;
  // The part of `used` that was this Worker.
  lookout: number;
  limit: number;
  since: string;
  asOf: string;
};

// Two plain totals: grouping by scriptName files deleted Workers under
// "__unknown__" and muddles the split.
// Variable types follow Cloudflare's Workers metrics example.
const QUERY = `query ($account: string, $script: string, $start: string, $end: string) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      all: workersInvocationsAdaptive(
        limit: 1
        filter: { datetime_geq: $start, datetime_leq: $end }
      ) {
        sum { requests }
      }
      mine: workersInvocationsAdaptive(
        limit: 1
        filter: { scriptName: $script, datetime_geq: $start, datetime_leq: $end }
      ) {
        sum { requests }
      }
    }
  }
}`;

type Totals = Array<{ sum: { requests: number } }> | undefined;

type AnalyticsBody = {
  data?: { viewer?: { accounts?: Array<{ all?: Totals; mine?: Totals }> } } | null;
  errors?: Array<{ message: string }> | null;
};

const total = (rows: Totals) =>
  (rows ?? []).reduce((n, row) => n + row.sum.requests, 0);

export async function fetchQuota(
  token: string,
  account: string,
  now = new Date(),
): Promise<QuotaReport> {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        account,
        script: SCRIPT,
        start: start.toISOString(),
        end: now.toISOString(),
      },
    }),
  });
  if (!res.ok) throw new Error(`Cloudflare analytics ${res.status}`);
  const body = (await res.json()) as AnalyticsBody;
  if (body.errors?.length) throw new Error(body.errors[0].message);

  const totals = body.data?.viewer?.accounts?.[0];
  return {
    used: total(totals?.all),
    lookout: total(totals?.mine),
    limit: DAILY_REQUESTS,
    since: start.toISOString(),
    asOf: now.toISOString(),
  };
}

export async function quotaResponse(token?: string, account?: string) {
  if (!token || !account) {
    return Response.json(
      { error: "Set ANALYTICS_TOKEN and ANALYTICS_ACCOUNT_ID to see Worker usage." },
      { status: 503 },
    );
  }
  try {
    return Response.json(await fetchQuota(token, account), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Usage unavailable";
    return Response.json({ error }, { status: 502 });
  }
}
