import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { copy, getCopyLocale } from "../lib/copy";
import { isMockEnabled } from "../lib/mock-data";
import { Button, Card, ConfirmModal, Input } from "../ui/components";
import { LocalOnlyNotice } from "../components/LocalOnlyNotice.jsx";
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  updateSubscription,
} from "../lib/subscription-manager-api";

// The subscription store only exists on the local CLI (it lives next to
// queue.jsonl); on the deployed web app there is nothing to read. Same
// pattern as LimitsPage / SkillsPage.
const IS_LOCAL_HOST =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

const EMPTY_FORM = { service: "", plan: "", autoRenew: true, nextBillingAt: "" };

// datetime-local values are wall-clock local time by spec; build the exact
// local string from a stored UTC ISO timestamp so editing round-trips.
function toDatetimeLocalValue(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function countdownText(nextBillingAt, now) {
  const diff = new Date(nextBillingAt).getTime() - now;
  if (diff <= 0) return copy("subscriptions.expired");
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return copy("subscriptions.countdown", { days, hours, minutes });
}

export function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(getCopyLocale(), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setSubscriptions(await listSubscriptions());
      setLoadError(false);
    } catch (_e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh countdowns once a minute without re-fetching the store.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(false);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((subscription) => {
    setForm({
      service: subscription.service,
      plan: subscription.plan || "",
      autoRenew: subscription.autoRenew,
      nextBillingAt: toDatetimeLocalValue(subscription.nextBillingAt),
    });
    setEditingId(subscription.id);
    setFormError(false);
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(false);
  }, []);

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setFormError(false);
      const timestamp = new Date(form.nextBillingAt).getTime();
      if (!Number.isFinite(timestamp)) {
        setFormError(true);
        return;
      }
      const payload = {
        service: form.service,
        plan: form.plan,
        autoRenew: form.autoRenew,
        nextBillingAt: timestamp,
      };
      setSaving(true);
      try {
        if (editingId) {
          await updateSubscription(editingId, payload);
        } else {
          await createSubscription(payload);
        }
        closeForm();
        await refresh();
      } catch (_e) {
        setFormError(true);
      } finally {
        setSaving(false);
      }
    },
    [closeForm, editingId, form, refresh],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteSubscription(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
    } catch (_e) {
      setLoadError(true);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, refresh]);

  const renderBody = () => {
    if (loading) {
      return (
        <div className="rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 p-5 animate-pulse">
          <div className="h-4 w-1/3 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
          <div className="mt-3 h-3 w-2/3 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
        </div>
      );
    }

    if (subscriptions.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-oai-gray-200 dark:border-oai-gray-800 px-6 py-16 text-center">
          <CalendarClock className="h-8 w-8 text-oai-gray-300 dark:text-oai-gray-700 mb-3" aria-hidden />
          <p className="text-sm font-medium text-oai-black dark:text-white">
            {copy("subscriptions.empty.title")}
          </p>
          <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
            {copy("subscriptions.empty.body")}
          </p>
        </div>
      );
    }

    return (
      <ul className="grid grid-cols-1 gap-4">
        {subscriptions.map((subscription) => {
          const expired = new Date(subscription.nextBillingAt).getTime() <= now;
          return (
            <li key={subscription.id}>
              <Card bodyClassName="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-oai-black dark:text-white">
                        {subscription.service}
                      </span>
                      {subscription.plan ? (
                        <span className="text-xs rounded-full border border-oai-gray-200 dark:border-oai-gray-700 px-2 py-0.5 text-oai-gray-500 dark:text-oai-gray-400">
                          {subscription.plan}
                        </span>
                      ) : null}
                      <span
                        className={`text-xs rounded-full px-2 py-0.5 ${
                          subscription.autoRenew
                            ? "bg-oai-brand-50 text-oai-brand-700 dark:bg-oai-brand-950 dark:text-oai-brand-300"
                            : "bg-oai-gray-100 text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400"
                        }`}
                      >
                        {subscription.autoRenew
                          ? copy("subscriptions.status.auto_renew")
                          : copy("subscriptions.status.manual")}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-oai-gray-600 dark:text-oai-gray-300">
                      <span className="text-oai-gray-400 dark:text-oai-gray-500">
                        {subscription.autoRenew
                          ? copy("subscriptions.label.renews_at")
                          : copy("subscriptions.label.expires_at")}
                      </span>{" "}
                      <span className="font-mono tabular-nums">
                        {dateFormat.format(new Date(subscription.nextBillingAt))}
                      </span>
                    </p>
                    <p
                      className={`mt-1 text-xs ${
                        expired
                          ? "text-oai-error"
                          : "text-oai-gray-500 dark:text-oai-gray-400"
                      }`}
                    >
                      {countdownText(subscription.nextBillingAt, now)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(subscription)}
                      aria-label={copy("subscriptions.edit")}
                      title={copy("subscriptions.edit")}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 text-oai-gray-600 dark:text-oai-gray-400 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 hover:text-oai-black dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(subscription)}
                      aria-label={copy("subscriptions.delete")}
                      title={copy("subscriptions.delete")}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 text-oai-gray-600 dark:text-oai-gray-400 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 hover:text-red-600 dark:hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    );
  };

  if (!IS_LOCAL_HOST && !isMockEnabled()) {
    return (
      <div className="flex flex-col flex-1 text-oai-black dark:text-oai-white font-oai antialiased">
        <LocalOnlyNotice />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 text-oai-black dark:text-oai-white font-oai antialiased">
      <main className="flex-1 pt-8 sm:pt-10 pb-12 sm:pb-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="flex flex-row items-start justify-between gap-4 mb-8">
            <div className="min-w-0">
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-oai-black dark:text-white mb-3">
                {copy("subscriptions.page.title")}
              </h1>
              <p className="text-oai-gray-500 dark:text-oai-gray-400 text-sm sm:text-base">
                {copy("subscriptions.page.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button type="button" size="sm" onClick={openAdd} className="gap-1.5">
                <Plus size={14} strokeWidth={2} aria-hidden />
                <span>{copy("subscriptions.add")}</span>
              </Button>
            </div>
          </div>

          {formOpen ? (
            <Card className="mb-6">
              <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={copy("subscriptions.form.service")}
                  value={form.service}
                  maxLength={120}
                  required
                  placeholder={copy("subscriptions.form.service_placeholder")}
                  onChange={(event) => setForm({ ...form, service: event.target.value })}
                />
                <Input
                  label={copy("subscriptions.form.plan")}
                  value={form.plan}
                  maxLength={120}
                  placeholder={copy("subscriptions.form.plan_placeholder")}
                  onChange={(event) => setForm({ ...form, plan: event.target.value })}
                />
                <Input
                  label={copy("subscriptions.form.next_billing")}
                  type="datetime-local"
                  value={form.nextBillingAt}
                  required
                  onChange={(event) => setForm({ ...form, nextBillingAt: event.target.value })}
                />
                <div className="flex flex-col">
                  <span className="block text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300 mb-1.5">
                    {copy("subscriptions.form.auto_renew")}
                  </span>
                  <label className="flex h-10 items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={form.autoRenew}
                      onChange={(event) => setForm({ ...form, autoRenew: event.target.checked })}
                      className="h-4 w-4 accent-oai-brand"
                    />
                    <span className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
                      {copy("subscriptions.form.auto_renew_hint")}
                    </span>
                  </label>
                </div>
                <div className="sm:col-span-2 flex items-center justify-end gap-2">
                  {formError ? (
                    <p className="mr-auto text-sm text-oai-error" role="alert">
                      {copy("subscriptions.form.error")}
                    </p>
                  ) : null}
                  <Button type="button" variant="secondary" size="sm" onClick={closeForm}>
                    {copy("shared.action.cancel")}
                  </Button>
                  <Button type="submit" size="sm" disabled={saving}>
                    {copy("subscriptions.save")}
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}

          {loadError ? (
            <p className="mb-4 text-sm text-oai-error" role="alert">
              {copy("subscriptions.load_error")}
            </p>
          ) : null}

          {renderBody()}
        </div>
      </main>

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title={copy("subscriptions.confirm_delete_title")}
        description={pendingDelete?.service || ""}
        confirmLabel={copy("subscriptions.delete")}
        cancelLabel={copy("shared.action.cancel")}
        destructive
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
