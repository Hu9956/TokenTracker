import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubscription,
  deleteSubscription,
  updateSubscription,
} from "../../../lib/subscription-manager-api";
import { SubscriptionSettingsCard } from "./SubscriptionSettingsCard.jsx";

vi.mock("../../../lib/subscription-manager-api", () => ({
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
}));

function makeSubscription(overrides = {}) {
  return {
    id: "sub-1",
    service: "GPT",
    plan: "Plus",
    provider: null,
    autoRenew: true,
    nextBillingAt: new Date(Date.now() + ((2 * 24 + 3) * 60 + 4) * 60000 + 30000).toISOString(),
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  createSubscription.mockResolvedValue(makeSubscription());
  updateSubscription.mockResolvedValue(makeSubscription());
  deleteSubscription.mockResolvedValue({ removed: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SubscriptionSettingsCard", () => {
  it("shows the empty state when there are no subscriptions", () => {
    render(<SubscriptionSettingsCard subscriptions={[]} onChanged={vi.fn()} />);

    expect(screen.getByText("No subscriptions yet")).toBeInTheDocument();
    expect(screen.getByText("Add subscription")).toBeInTheDocument();
  });

  it("lists subscriptions and expands details on click", () => {
    render(
      <SubscriptionSettingsCard
        subscriptions={[
          makeSubscription(),
          makeSubscription({
            id: "sub-2",
            service: "Claude",
            plan: null,
            autoRenew: false,
            nextBillingAt: new Date(Date.now() - 60 * 60000).toISOString(),
          }),
        ]}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText("GPT")).toBeInTheDocument();
    expect(screen.getByText("Plus")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();

    fireEvent.click(screen.getByText("GPT"));
    expect(screen.getByText("Auto-renew on")).toBeInTheDocument();
    expect(screen.getByText("Next renewal")).toBeInTheDocument();
    expect(screen.getByText("in 2d 3h 4m")).toBeInTheDocument();
  });

  it("creates a subscription with the selected linked tool and notifies the parent", async () => {
    const onChanged = vi.fn();
    render(<SubscriptionSettingsCard subscriptions={[]} onChanged={onChanged} />);

    fireEvent.click(screen.getByText("Add subscription"));
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "GPT" } });
    fireEvent.change(screen.getByLabelText("Plan"), { target: { value: "Plus" } });
    fireEvent.change(screen.getByLabelText("Next renewal / expiry"), {
      target: { value: "2026-08-16T14:00" },
    });
    // The linked-tool picker is the shared Base UI Select, so open the popup
    // and pick the option instead of firing a native change event. Base UI
    // ignores synthetic clicks on unhovered items, so press first like a real
    // pointer would.
    fireEvent.click(screen.getByLabelText("Linked tool"));
    const codexOption = await screen.findByRole("option", { name: "Codex" });
    fireEvent.pointerDown(codexOption, { pointerType: "mouse" });
    fireEvent.click(codexOption);

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(createSubscription).toHaveBeenCalledTimes(1);
    });
    expect(createSubscription).toHaveBeenCalledWith({
      service: "GPT",
      plan: "Plus",
      provider: "codex",
      cycle: "monthly",
      autoRenew: true,
      nextBillingAt: new Date("2026-08-16T14:00").getTime(),
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("deletes a subscription after confirmation and notifies the parent", async () => {
    const onChanged = vi.fn();
    render(
      <SubscriptionSettingsCard subscriptions={[makeSubscription()]} onChanged={onChanged} />,
    );

    fireEvent.click(screen.getByText("GPT"));
    fireEvent.click(screen.getByText("Delete"));

    const confirmButton = await screen.findAllByText("Delete");
    fireEvent.click(confirmButton[confirmButton.length - 1]);

    await waitFor(() => {
      expect(deleteSubscription).toHaveBeenCalledWith("sub-1");
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
