import { copy } from "./copy";

// Shared billing-cycle helpers for subscription display. Used by both the
// /subscriptions page and the inline subscription rows on the Limits page so
// the two surfaces render identical progress/remaining values.

// A billing cycle is one calendar month ending at nextBillingAt (the product's
// default mental model for subscriptions). Day is clamped so Mar 31 maps back
// to Feb 28/29 instead of rolling into March.
export function cycleStartFor(nextBillingAt) {
  const end = new Date(nextBillingAt);
  const daysInPrevMonth = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
  const start = new Date(
    end.getFullYear(),
    end.getMonth() - 1,
    1,
    end.getHours(),
    end.getMinutes(),
  );
  start.setDate(Math.min(end.getDate(), daysInPrevMonth));
  return start;
}

export function cycleMetrics(nextBillingAt, now) {
  const endMs = new Date(nextBillingAt).getTime();
  const startMs = cycleStartFor(nextBillingAt).getTime();
  const span = Math.max(1, endMs - startMs);
  const progress = Math.max(0, Math.min(1, (now - startMs) / span));
  const cycleDays = Math.max(1, Math.round(span / 86400000));
  return { progress, cycleDays };
}

// Compact right-hand label, same vocabulary as the limits bar ("6d", "17h").
export function remainingLabel(nextBillingAt, now) {
  const diff = new Date(nextBillingAt).getTime() - now;
  if (diff <= 0) return copy("subscriptions.expired");
  const totalMinutes = Math.ceil(diff / 60000);
  if (totalMinutes < 60) return copy("shared.time.m_ago", { n: totalMinutes });
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return copy("shared.time.h_ago", { n: totalHours });
  return copy("shared.time.d_ago", { n: Math.floor(totalHours / 24) });
}

export function countdownText(nextBillingAt, now) {
  const diff = new Date(nextBillingAt).getTime() - now;
  if (diff <= 0) return copy("subscriptions.expired");
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return copy("subscriptions.countdown", { days, hours, minutes });
}
