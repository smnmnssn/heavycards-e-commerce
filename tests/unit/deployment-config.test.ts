import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { HANDLED_EVENT_TYPES } from "@/server/payments/webhook";

/*
 * Vercel deployment configuration (Milestone 15, docs/launch-runbook.md).
 * The production plan is Vercel Pro: payment and email recovery rely on the
 * scheduled run every 15 minutes, not the daily Hobby schedule.
 */

const readJson = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const vercel = readJson("vercel.json") as {
  installCommand?: string;
  regions?: string[];
  crons?: Array<{ path: string; schedule: string }>;
};

describe("vercel.json", () => {
  it("runs the reconciliation job every 15 minutes", () => {
    expect(vercel.crons).toEqual([
      { path: "/api/cron/reconcile-checkouts", schedule: "*/15 * * * *" },
    ]);
  });

  it("points every cron job at an existing GET route", () => {
    for (const { path } of vercel.crons ?? []) {
      const file = `src/app${path}/route.ts`;
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8")).toMatch(/export async function GET\(/);
    }
  });

  it("runs functions next to the production database (Neon Frankfurt)", () => {
    expect(vercel.regions).toEqual(["fra1"]);
  });

  it("installs exactly the locked dependencies", () => {
    expect(vercel.installCommand).toBe("npm ci");
  });
});

describe("Node.js version", () => {
  it("is the same major in package.json, .nvmrc and CI", () => {
    const engines = (readJson("package.json").engines ?? {}) as {
      node?: string;
    };
    expect(engines.node).toBe("24.x");
    expect(readFileSync(".nvmrc", "utf8").trim()).toBe("24");
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toMatch(
      /node-version-file: \.nvmrc/,
    );
  });
});

describe("Stripe webhook endpoint setup", () => {
  it("the launch runbook lists exactly the events the webhook handles", () => {
    const runbook = readFileSync("docs/launch-runbook.md", "utf8");
    const block =
      /<!-- stripe-webhook-events:start -->([\s\S]*?)<!-- stripe-webhook-events:end -->/.exec(
        runbook,
      );
    expect(block, "event list markers").not.toBeNull();
    const documented = [...block![1]!.matchAll(/^- `([a-z_.]+)`$/gm)].map(
      (match) => match[1],
    );
    expect(documented).toEqual([...HANDLED_EVENT_TYPES]);
  });
});
