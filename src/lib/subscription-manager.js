const path = require("node:path");
const crypto = require("node:crypto");

const { readJsonStrict, writeFileAtomic, chmod600IfPossible } = require("./fs");

// Manual subscription manager: user-entered billing plans (service, plan,
// auto-renew flag, next renewal/expiry timestamp). Distinct from
// subscriptions.js (auto-detected local plan tiers) and usage-limits.js
// (rate-limit window resets) — see issue #460.
const STORE_FILE = "subscription-manager.json";
const STORE_VERSION = 1;
const MAX_TEXT_LENGTH = 120;

function resolveSubscriptionsPath(trackerDir) {
  return path.join(trackerDir, STORE_FILE);
}

function normalizeText(value, { required, field, maxLength = MAX_TEXT_LENGTH } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

// Accepts epoch milliseconds or any Date-parseable string. Stored values are
// UTC ISO strings truncated to whole minutes so comparisons stay clean and a
// second-level drift between input formats never changes the billed minute.
function normalizeBillingTime(value) {
  let ms;
  if (typeof value === "number") {
    ms = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("nextBillingAt is required");
    ms = new Date(trimmed).getTime();
  } else {
    throw new Error("nextBillingAt is required");
  }
  if (!Number.isFinite(ms)) throw new Error("nextBillingAt must be a valid date");
  return new Date(Math.floor(ms / 60000) * 60000).toISOString();
}

function normalizeSubscriptionFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("subscription must be an object");
  }
  if (typeof fields.autoRenew !== "boolean") {
    throw new Error("autoRenew must be a boolean");
  }
  return {
    service: normalizeText(fields.service, { required: true, field: "service" }),
    plan: normalizeText(fields.plan ?? null, { required: false, field: "plan" }),
    // Optional link to a usage-limits provider row (e.g. "codex"). The value
    // is a limits provider id but is not validated against the canonical list
    // here — the backend stays lenient, the dropdown constrains it in the UI.
    provider: normalizeText(fields.provider ?? null, {
      required: false,
      field: "provider",
      maxLength: 64,
    }),
    autoRenew: fields.autoRenew,
    nextBillingAt: normalizeBillingTime(fields.nextBillingAt),
  };
}

function isValidStoredRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (typeof record.id !== "string" || !record.id) return false;
  if (typeof record.service !== "string" || !record.service) return false;
  if (typeof record.autoRenew !== "boolean") return false;
  if (typeof record.nextBillingAt !== "string") return false;
  return Number.isFinite(new Date(record.nextBillingAt).getTime());
}

async function readStore(filePath) {
  const { status, value } = await readJsonStrict(filePath);
  if (status !== "ok" || !value || typeof value !== "object" || Array.isArray(value)) {
    return { version: STORE_VERSION, items: [] };
  }
  const items = Array.isArray(value.items) ? value.items.filter(isValidStoredRecord) : [];
  const version = Number.isFinite(value.version) ? value.version : STORE_VERSION;
  return { version, items };
}

async function writeStore(filePath, store) {
  await writeFileAtomic(filePath, JSON.stringify(store, null, 2) + "\n");
  await chmod600IfPossible(filePath);
}

function sortByNextBillingAt(items) {
  return [...items].sort((a, b) =>
    new Date(a.nextBillingAt).getTime() - new Date(b.nextBillingAt).getTime(),
  );
}

// In-process FIFO queue per store file. Every mutation is a full
// read-modify-write transaction; without serialization two concurrent writes
// read the same snapshot and the later one silently drops the earlier change
// (issue: 30 concurrent creates survived as a single record). The queue keeps
// independent store files unblocked while ordering operations on the same one.
const storeLocks = new Map();

function withStoreLock(filePath, operation) {
  const previous = storeLocks.get(filePath) || Promise.resolve();
  // Run even if the previous transaction rejected; its error already reached
  // its own caller and must not wedge the queue.
  const run = previous.then(operation, operation);
  storeLocks.set(filePath, run.then(() => undefined, () => undefined));
  return run;
}

async function listSubscriptions({ trackerDir }) {
  const store = await readStore(resolveSubscriptionsPath(trackerDir));
  return sortByNextBillingAt(store.items);
}

async function createSubscription({ trackerDir, fields }) {
  // Validate before taking the lock so a bad payload never queues a write.
  const normalized = normalizeSubscriptionFields(fields);
  const filePath = resolveSubscriptionsPath(trackerDir);
  return withStoreLock(filePath, async () => {
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      ...normalized,
      createdAt: now,
      updatedAt: now,
    };
    const store = await readStore(filePath);
    store.items.push(record);
    await writeStore(filePath, store);
    return record;
  });
}

async function updateSubscription({ trackerDir, id, fields }) {
  if (typeof id !== "string" || !id) throw new Error("id is required");
  const filePath = resolveSubscriptionsPath(trackerDir);
  return withStoreLock(filePath, async () => {
    const store = await readStore(filePath);
    const index = store.items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("Subscription not found");
    const existing = store.items[index];
    // Merge over the existing record so callers may send only changed fields.
    const merged = normalizeSubscriptionFields({ ...existing, ...(fields || {}) });
    const record = {
      ...existing,
      ...merged,
      updatedAt: new Date().toISOString(),
    };
    store.items[index] = record;
    await writeStore(filePath, store);
    return record;
  });
}

async function deleteSubscription({ trackerDir, id }) {
  if (typeof id !== "string" || !id) throw new Error("id is required");
  const filePath = resolveSubscriptionsPath(trackerDir);
  return withStoreLock(filePath, async () => {
    const store = await readStore(filePath);
    const index = store.items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("Subscription not found");
    store.items.splice(index, 1);
    await writeStore(filePath, store);
    return { removed: true };
  });
}

module.exports = {
  listSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  resolveSubscriptionsPath,
};
