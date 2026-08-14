const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");

const {
  listSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  resolveSubscriptionsPath,
} = require("../src/lib/subscription-manager");

async function makeTrackerDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readStoreFile(trackerDir) {
  const raw = await fs.readFile(resolveSubscriptionsPath(trackerDir), "utf8");
  return JSON.parse(raw);
}

const VALID_FIELDS = {
  service: "GPT",
  plan: "Plus",
  autoRenew: true,
  nextBillingAt: "2026-08-16T06:00:00.000Z",
};

test("createSubscription persists a versioned envelope and lists it back", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-");
  try {
    const created = await createSubscription({ trackerDir, fields: VALID_FIELDS });
    assert.ok(created.id);
    assert.equal(created.service, "GPT");
    assert.equal(created.plan, "Plus");
    assert.equal(created.autoRenew, true);
    assert.equal(created.nextBillingAt, "2026-08-16T06:00:00.000Z");
    assert.ok(created.createdAt);
    assert.ok(created.updatedAt);

    const store = await readStoreFile(trackerDir);
    assert.equal(store.version, 1);
    assert.equal(store.items.length, 1);

    const listed = await listSubscriptions({ trackerDir });
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0], created);
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("listSubscriptions returns an empty list when the store is missing", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-missing-");
  try {
    assert.deepEqual(await listSubscriptions({ trackerDir }), []);
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("listSubscriptions tolerates a corrupt store file", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-corrupt-");
  try {
    await fs.writeFile(resolveSubscriptionsPath(trackerDir), "{not json", "utf8");
    assert.deepEqual(await listSubscriptions({ trackerDir }), []);
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("listSubscriptions sorts by nextBillingAt ascending", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-sort-");
  try {
    await createSubscription({
      trackerDir,
      fields: { ...VALID_FIELDS, service: "Later", nextBillingAt: "2026-09-01T00:00:00.000Z" },
    });
    await createSubscription({
      trackerDir,
      fields: { ...VALID_FIELDS, service: "Sooner", nextBillingAt: "2026-08-16T06:00:00.000Z" },
    });
    const listed = await listSubscriptions({ trackerDir });
    assert.deepEqual(listed.map((s) => s.service), ["Sooner", "Later"]);
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("createSubscription validates required fields", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-validate-");
  try {
    await assert.rejects(
      createSubscription({ trackerDir, fields: { ...VALID_FIELDS, service: "" } }),
      /service is required/,
    );
    await assert.rejects(
      createSubscription({ trackerDir, fields: { ...VALID_FIELDS, service: "  " } }),
      /service is required/,
    );
    await assert.rejects(
      createSubscription({ trackerDir, fields: { ...VALID_FIELDS, service: "x".repeat(121) } }),
      /service must be at most 120 characters/,
    );
    await assert.rejects(
      createSubscription({ trackerDir, fields: { ...VALID_FIELDS, autoRenew: "yes" } }),
      /autoRenew must be a boolean/,
    );
    await assert.rejects(
      createSubscription({ trackerDir, fields: { ...VALID_FIELDS, nextBillingAt: null } }),
      /nextBillingAt is required/,
    );
    await assert.rejects(
      createSubscription({ trackerDir, fields: { ...VALID_FIELDS, nextBillingAt: "not-a-date" } }),
      /nextBillingAt must be a valid date/,
    );
    await assert.rejects(
      createSubscription({ trackerDir, fields: { ...VALID_FIELDS, provider: 123 } }),
      /provider must be a string/,
    );
    await assert.rejects(
      createSubscription({ trackerDir, fields: { ...VALID_FIELDS, provider: "x".repeat(65) } }),
      /provider must be at most 64 characters/,
    );
    // plan and provider are optional and blank normalizes to null.
    const created = await createSubscription({
      trackerDir,
      fields: { ...VALID_FIELDS, plan: "   ", provider: "  " },
    });
    assert.equal(created.plan, null);
    assert.equal(created.provider, null);
    const withProvider = await createSubscription({
      trackerDir,
      fields: { ...VALID_FIELDS, service: "Codex", provider: "codex" },
    });
    assert.equal(withProvider.provider, "codex");
    const listed = await listSubscriptions({ trackerDir });
    assert.equal(listed.length, 2);
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("createSubscription normalizes nextBillingAt to UTC minute precision", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-normalize-");
  try {
    // Epoch milliseconds with seconds/millis — floored to the whole minute.
    const withSeconds = await createSubscription({
      trackerDir,
      fields: {
        ...VALID_FIELDS,
        service: "Seconds",
        nextBillingAt: Date.UTC(2026, 7, 16, 6, 0, 45, 999),
      },
    });
    assert.equal(withSeconds.nextBillingAt, "2026-08-16T06:00:00.000Z");

    // ISO string input round-trips unchanged at minute precision.
    const iso = await createSubscription({
      trackerDir,
      fields: { ...VALID_FIELDS, service: "Iso", nextBillingAt: "2026-08-16T06:00:00.000Z" },
    });
    assert.equal(iso.nextBillingAt, "2026-08-16T06:00:00.000Z");

    // Timezone boundary: Beijing (UTC+8) 2026-08-17 00:30 is the previous UTC day.
    const beijingMidnight = await createSubscription({
      trackerDir,
      fields: {
        ...VALID_FIELDS,
        service: "Beijing",
        nextBillingAt: Date.UTC(2026, 7, 16, 16, 30),
      },
    });
    assert.equal(beijingMidnight.nextBillingAt, "2026-08-16T16:30:00.000Z");
    assert.equal(new Date(beijingMidnight.nextBillingAt).getUTCSeconds(), 0);
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("updateSubscription merges partial fields and preserves identity", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-update-");
  try {
    const created = await createSubscription({ trackerDir, fields: VALID_FIELDS });
    const updated = await updateSubscription({
      trackerDir,
      id: created.id,
      fields: { autoRenew: false, nextBillingAt: "2026-09-30T12:00:00.000Z" },
    });
    assert.equal(updated.id, created.id);
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(updated.service, "GPT");
    assert.equal(updated.plan, "Plus");
    assert.equal(updated.autoRenew, false);
    assert.equal(updated.nextBillingAt, "2026-09-30T12:00:00.000Z");

    const listed = await listSubscriptions({ trackerDir });
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0], updated);
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("updateSubscription validates merged fields", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-update-invalid-");
  try {
    const created = await createSubscription({ trackerDir, fields: VALID_FIELDS });
    await assert.rejects(
      updateSubscription({ trackerDir, id: created.id, fields: { service: "" } }),
      /service is required/,
    );
    // The failed update must not have mutated the stored record.
    const listed = await listSubscriptions({ trackerDir });
    assert.equal(listed[0].service, "GPT");
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("deleteSubscription removes the record", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-delete-");
  try {
    const created = await createSubscription({ trackerDir, fields: VALID_FIELDS });
    const result = await deleteSubscription({ trackerDir, id: created.id });
    assert.deepEqual(result, { removed: true });
    assert.deepEqual(await listSubscriptions({ trackerDir }), []);
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("update and delete reject unknown ids", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-notfound-");
  try {
    await assert.rejects(
      updateSubscription({ trackerDir, id: "no-such-id", fields: VALID_FIELDS }),
      /Subscription not found/,
    );
    await assert.rejects(
      deleteSubscription({ trackerDir, id: "no-such-id" }),
      /Subscription not found/,
    );
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("30 concurrent creates are serialized and none are lost", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-concurrent-create-");
  try {
    // Reproduces the review repro: before the per-file lock, concurrent
    // read-modify-write cycles collapsed ~30 creates into a single record.
    const created = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        createSubscription({
          trackerDir,
          fields: {
            ...VALID_FIELDS,
            service: `Service ${i}`,
            nextBillingAt: Date.UTC(2026, 7, 16, 6, 0) + i * 60000,
          },
        }),
      ),
    );
    assert.equal(created.length, 30);

    const listed = await listSubscriptions({ trackerDir });
    assert.equal(listed.length, 30);
    assert.equal(new Set(listed.map((s) => s.id)).size, 30);
    assert.equal(new Set(listed.map((s) => s.service)).size, 30);
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("interleaved updates and deletes stay consistent", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-concurrent-mix-");
  try {
    const records = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createSubscription({
          trackerDir,
          fields: { ...VALID_FIELDS, service: `Service ${i}` },
        }),
      ),
    );
    const ids = records.map((r) => r.id);

    // Delete records 0/2/4 while repeatedly updating 1/3, all in flight at once.
    const ops = [];
    for (const id of [ids[0], ids[2], ids[4]]) {
      ops.push(deleteSubscription({ trackerDir, id }));
    }
    for (let round = 0; round < 5; round += 1) {
      for (const id of [ids[1], ids[3]]) {
        ops.push(updateSubscription({ trackerDir, id, fields: { plan: `Plan ${round}` } }));
      }
    }
    const results = await Promise.allSettled(ops);
    for (const result of results) assert.equal(result.status, "fulfilled");

    const listed = await listSubscriptions({ trackerDir });
    assert.deepEqual(listed.map((s) => s.id).sort(), [ids[1], ids[3]].sort());
    // No deleted record may be resurrected by a racing write.
    for (const removed of [ids[0], ids[2], ids[4]]) {
      assert.ok(!listed.some((s) => s.id === removed));
    }
    for (const item of listed) assert.equal(item.plan, "Plan 4");
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});

test("a queued update cannot resurrect a record deleted before it", async () => {
  const trackerDir = await makeTrackerDir("tt-subscription-manager-order-");
  try {
    const record = await createSubscription({ trackerDir, fields: VALID_FIELDS });
    // The delete is queued first, so the following update must see the record
    // as gone rather than rewriting a store snapshot taken before the delete.
    const deleteOp = deleteSubscription({ trackerDir, id: record.id });
    const updateOp = updateSubscription({
      trackerDir,
      id: record.id,
      fields: { plan: "Should not stick" },
    });
    await deleteOp;
    await assert.rejects(updateOp, /Subscription not found/);
    assert.deepEqual(await listSubscriptions({ trackerDir }), []);
  } finally {
    await fs.rm(trackerDir, { recursive: true, force: true });
  }
});
