import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  updateSubscription,
} from "../lib/subscription-manager-api";
import { SubscriptionsPage } from "./SubscriptionsPage.jsx";

vi.mock("../lib/subscription-manager-api", () => ({
  listSubscriptions: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
}));

function makeSubscription(overrides = {}) {
  return {
    id: "sub-1",
    service: "GPT",
    plan: "Plus",
    autoRenew: true,
    // ~2d 3h 4m in the future relative to test start.
    nextBillingAt: new Date(Date.now() + ((2 * 24 + 3) * 60 + 4) * 60000 + 30000).toISOString(),
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  listSubscriptions.mockResolvedValue([]);
  createSubscription.mockResolvedValue(makeSubscription());
  updateSubscription.mockResolvedValue(makeSubscription());
  deleteSubscription.mockResolvedValue({ removed: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SubscriptionsPage", () => {
  it("shows the empty state when no subscriptions exist", async () => {
    render(<SubscriptionsPage />);

    await waitFor(() => {
      expect(screen.getByText("No subscriptions yet")).toBeInTheDocument();
    });
    expect(screen.getByText("Add subscription")).toBeInTheDocument();
  });

  it("lists subscriptions with status, dates and countdown", async () => {
    listSubscriptions.mockResolvedValue([
      makeSubscription(),
      makeSubscription({
        id: "sub-2",
        service: "Claude",
        plan: null,
        autoRenew: false,
        nextBillingAt: new Date(Date.now() - 60 * 60000).toISOString(),
      }),
    ]);

    render(<SubscriptionsPage />);

    await waitFor(() => {
      expect(screen.getByText("GPT")).toBeInTheDocument();
    });
    expect(screen.getByText("Plus")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Auto-renew on")).toBeInTheDocument();
    expect(screen.getByText("Auto-renew off")).toBeInTheDocument();
    expect(screen.getByText("Next renewal")).toBeInTheDocument();
    expect(screen.getByText("Expires")).toBeInTheDocument();
    expect(screen.getByText("in 2d 3h 4m")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("creates a subscription with the form and refreshes the list", async () => {
    render(<SubscriptionsPage />);

    await waitFor(() => {
      expect(screen.getByText("No subscriptions yet")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Add subscription"));

    fireEvent.change(screen.getByLabelText("Service"), {
      target: { value: "GPT" },
    });
    fireEvent.change(screen.getByLabelText("Plan"), {
      target: { value: "Plus" },
    });
    // datetime-local values are local wall-clock time; the page must convert
    // them to an epoch-ms timestamp for the API.
    fireEvent.change(screen.getByLabelText("Next renewal / expiry"), {
      target: { value: "2026-08-16T14:00" },
    });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(createSubscription).toHaveBeenCalledTimes(1);
    });
    expect(createSubscription).toHaveBeenCalledWith({
      service: "GPT",
      plan: "Plus",
      autoRenew: true,
      nextBillingAt: new Date("2026-08-16T14:00").getTime(),
    });
    expect(listSubscriptions).toHaveBeenCalledTimes(2);
  });

  it("deletes a subscription after confirmation", async () => {
    listSubscriptions.mockResolvedValue([makeSubscription()]);

    render(<SubscriptionsPage />);

    await waitFor(() => {
      expect(screen.getByText("GPT")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Delete"));

    // The destructive confirm dialog offers Delete / Cancel.
    const confirmButton = await screen.findAllByText("Delete");
    fireEvent.click(confirmButton[confirmButton.length - 1]);

    await waitFor(() => {
      expect(deleteSubscription).toHaveBeenCalledWith("sub-1");
    });
  });
});
