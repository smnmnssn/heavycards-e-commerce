import { describe, expect, it } from "vitest";

import { checkoutFailureMessage } from "@/lib/checkout/checkout";
import {
  exceededHoldLimit,
  MAX_HELD_UNITS_PER_CLIENT,
  MAX_OPEN_CHECKOUTS_PER_CLIENT,
} from "@/server/domain/checkout";
import { describeOrderEvent } from "@/server/admin/orders/presenters";
import { parseOrderNumber } from "@/server/operations/payment-hold";

describe("open holds per client (Milestone 14)", () => {
  it("allows a customer's ordinary checkouts", () => {
    expect(exceededHoldLimit({ checkouts: 0, units: 0 }, 5)).toBeNull();
    expect(
      exceededHoldLimit(
        { checkouts: MAX_OPEN_CHECKOUTS_PER_CLIENT - 1, units: 10 },
        MAX_HELD_UNITS_PER_CLIENT - 10,
      ),
    ).toBeNull();
  });

  it("refuses a further checkout once the client has the maximum open", () => {
    expect(
      exceededHoldLimit(
        { checkouts: MAX_OPEN_CHECKOUTS_PER_CLIENT, units: 3 },
        1,
      ),
    ).toBe("checkouts");
  });

  it("refuses holding more units than one client may, in one or several checkouts", () => {
    expect(
      exceededHoldLimit(
        { checkouts: 0, units: 0 },
        MAX_HELD_UNITS_PER_CLIENT + 1,
      ),
    ).toBe("units");
    expect(
      exceededHoldLimit({ checkouts: 1, units: MAX_HELD_UNITS_PER_CLIENT }, 1),
    ).toBe("units");
  });

  it("explains both limits in Swedish without technical detail", () => {
    const checkouts = checkoutFailureMessage(
      { ok: false, code: "hold_limit", limit: "checkouts", maxUnits: 30 },
      () => null,
    );
    const units = checkoutFailureMessage(
      { ok: false, code: "hold_limit", limit: "units", maxUnits: 30 },
      () => null,
    );
    expect(checkouts.title).toMatch(/påbörjade betalningar/);
    expect(units.title).toMatch(/30 artiklar/);
    for (const { title } of [checkouts, units]) {
      expect(title).not.toMatch(/IP|hold|limit/i);
    }
  });
});

describe("operator helpers (Milestone 14)", () => {
  it.each([
    ["HC-10001", 10001],
    ["hc10042", 10042],
    [" 10003 ", 10003],
    ["HC-1", null],
    ["10001; DROP", null],
    ["", null],
  ])("parses order number %j", (input, expected) => {
    expect(parseOrderNumber(input)).toBe(expected);
  });

  it("describes operator actions in the order history", () => {
    expect(
      describeOrderEvent("OPERATOR_RELEASE_PAYMENT_HOLD", {
        evidence: "refunded",
        note: "anything",
      }),
    ).toMatch(/helt återbetald/);
    expect(
      describeOrderEvent("OPERATOR_RELEASE_PAYMENT_HOLD", {
        evidence: "payment_canceled",
      }),
    ).toMatch(/avbröts/);
    expect(
      describeOrderEvent("OPERATOR_REQUEUE_EMAIL", { kind: "ORDER_SHIPPED" }),
    ).toMatch(/leveransbesked/);
  });

  it("never shows the operator's free-text note in the history", () => {
    expect(
      describeOrderEvent("OPERATOR_RELEASE_PAYMENT_HOLD", {
        evidence: "refunded",
        note: "SECRET-NOTE",
      }),
    ).not.toContain("SECRET-NOTE");
  });
});
