import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { executeAccountDeletion } from "../src/lib/account-deletion.ts";

const PREVIEW_PROJECT_REF = "uvjykxydgzodxljlhthq";
const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !publishableKey || !serviceRoleKey) {
  throw new Error("Preview account-deletion test environment is incomplete.");
}
if (new URL(url).hostname.split(".")[0] !== PREVIEW_PROJECT_REF) {
  throw new Error("Refusing to run account-deletion integration tests outside the isolated Preview project.");
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createSyntheticIdentity() {
  const email = `account-deletion-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) throw new Error("Synthetic Auth user creation failed.");

  const userClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error("Synthetic Auth sign-in failed.");
  return { userId: created.user.id, userClient };
}

function deletionDependencies(userId, userClient) {
  const bucket = admin.storage.from("documents");
  return {
    begin: async () => {
      const { data, error } = await userClient.rpc("begin_account_deletion");
      if (error) throw new Error("Account-deletion marker failed.");
      return data;
    },
    storage: {
      list: async (prefix, options) => {
        const { data, error } = await bucket.list(prefix, {
          limit: options.limit,
          offset: options.offset,
          sortBy: { column: "name", order: "asc" },
        });
        if (error) throw new Error("Synthetic Storage listing failed.");
        return (data ?? []).map((entry) => ({ id: entry.id, name: entry.name }));
      },
      remove: async (paths) => {
        const { error } = await bucket.remove(paths);
        if (error) throw new Error("Synthetic Storage removal failed.");
      },
    },
    updateStatus: async (status) => {
      let update = admin
        .from("account_deletion_requests")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (status === "storage_cleared") {
        update = update.in("status", ["pending", "storage_cleared"]);
      }
      const { error } = await update;
      if (error) throw new Error("Synthetic account-deletion status update failed.");
    },
    deleteAuthUser: async () => {
      const { error } = await admin.auth.admin.deleteUser(userId, false);
      if (!error) return "deleted";
      if (error.status === 404 || error.code === "user_not_found" || /user not found/i.test(error.message)) {
        return "already_missing";
      }
      const { data } = await admin.auth.admin.getUserById(userId);
      if (!data.user) return "already_missing";
      throw new Error("Synthetic Auth deletion failed.");
    },
  };
}

async function insert(table, values) {
  const { data, error } = await admin.from(table).insert(values).select().single();
  if (error) throw new Error(`Synthetic ${table} seed failed.`);
  return data;
}

async function seedCompleteAccount(userId) {
  const source = "Synthetic academic content about cellular respiration and energy transfer.";
  const storagePath = `${userId}/${randomUUID()}-synthetic.pdf`;
  const { error: uploadError } = await admin.storage
    .from("documents")
    .upload(storagePath, Buffer.from("synthetic preview fixture"), { contentType: "application/pdf" });
  if (uploadError) throw new Error("Synthetic Storage upload failed.");

  const pdf = await insert("documents", {
    user_id: userId,
    title: "Synthetic PDF",
    file_url: storagePath,
    status: "processed",
    extracted_text: source,
  });
  await insert("documents", {
    user_id: userId,
    title: "Synthetic pasted note",
    file_url: null,
    status: "processed",
    extracted_text: source,
  });
  const topic = await insert("document_topics", {
    user_id: userId,
    document_id: pdf.id,
    title: "Cellular respiration",
    description: "A synthetic topic used only to validate account deletion cascades.",
    source_ranges: [{ start: 0, end: source.length }],
    source_hash: "a".repeat(64),
    position: 1,
  });
  await insert("summaries", {
    user_id: userId,
    document_id: pdf.id,
    topic_id: topic.id,
    locale: "en",
    title: "Synthetic summary",
    content: { overview: "Synthetic", keyPoints: [], conclusion: "Synthetic" },
  });
  const questionSet = await insert("question_sets", {
    user_id: userId,
    document_id: pdf.id,
    topic_id: topic.id,
    topic_scope_id: topic.id,
    locale: "en",
    kind: "standard",
    questions: [],
  });
  await insert("question_sessions", {
    user_id: userId,
    document_id: pdf.id,
    question_set_id: questionSet.id,
    total_questions: 1,
    correct_answers: 1,
    accuracy: 100,
    answers: [],
    completed_at: new Date().toISOString(),
  });
  const flashcardSet = await insert("flashcard_sets", {
    user_id: userId,
    document_id: pdf.id,
    topic_id: topic.id,
    locale: "en",
  });
  const flashcard = await insert("flashcards", {
    flashcard_set_id: flashcardSet.id,
    front: "What is cellular respiration?",
    back: "A synthetic answer for deletion validation.",
    position: 1,
  });
  await insert("flashcard_reviews", {
    user_id: userId,
    flashcard_id: flashcard.id,
    rating: "good",
    previous_due_at: new Date().toISOString(),
    next_due_at: new Date(Date.now() + 86_400_000).toISOString(),
    previous_interval_days: 0,
    next_interval_days: 1,
  });
  return { storagePath, flashcardId: flashcard.id };
}

async function verifyOldJwtIsBlocked(identity, fixture) {
  const { data: rows, error: readError } = await identity.userClient
    .from("documents")
    .select("id")
    .eq("user_id", identity.userId);
  assert.equal(readError, null);
  assert.equal(rows?.length, 0);

  const { error: writeError } = await identity.userClient.from("documents").insert({
    user_id: identity.userId,
    title: "Blocked synthetic mutation",
    file_url: null,
  });
  assert.ok(writeError);

  const { error: uploadError } = await identity.userClient.storage
    .from("documents")
    .upload(`${identity.userId}/blocked.txt`, "blocked");
  assert.ok(uploadError);

  const { error: reviewError } = await identity.userClient.rpc("review_flashcard", {
    p_flashcard_id: fixture.flashcardId,
    p_rating: "good",
  });
  assert.ok(reviewError);

  const { error: profileError } = await identity.userClient.auth.updateUser({
    data: { locale: "pt-BR" },
  });
  assert.ok(profileError);
}

async function assertAccountRemoved(userId, storagePath) {
  const { data: authResult } = await admin.auth.admin.getUserById(userId);
  assert.equal(authResult.user, null);

  for (const table of [
    "documents",
    "summaries",
    "document_topics",
    "question_sets",
    "question_sessions",
    "flashcard_sets",
    "flashcard_reviews",
    "account_deletion_requests",
  ]) {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq("user_id", userId);
    if (error) throw new Error(`Synthetic ${table} verification failed.`);
    assert.equal(count, 0);
  }

  if (storagePath) {
    const { data, error } = await admin.storage.from("documents").list(userId, { limit: 1 });
    if (error) throw new Error("Synthetic Storage verification failed.");
    assert.equal(data?.length, 0);
  }
}

async function main() {
  const createdUsers = new Set();
  try {
    const empty = await createSyntheticIdentity();
    createdUsers.add(empty.userId);
    await executeAccountDeletion(empty.userId, deletionDependencies(empty.userId, empty.userClient));
    await assertAccountRemoved(empty.userId);
    createdUsers.delete(empty.userId);
    console.log("ok - empty synthetic Preview account deleted idempotently");

    const complete = await createSyntheticIdentity();
    createdUsers.add(complete.userId);
    const fixture = await seedCompleteAccount(complete.userId);
    assert.equal(await complete.userClient.rpc("begin_account_deletion").then(({ data, error }) => {
      if (error) throw error;
      return data;
    }), "pending");
    await verifyOldJwtIsBlocked(complete, fixture);

    const results = await Promise.allSettled([
      executeAccountDeletion(complete.userId, deletionDependencies(complete.userId, complete.userClient)),
      executeAccountDeletion(complete.userId, deletionDependencies(complete.userId, complete.userClient)),
    ]);
    assert.ok(results.every((result) => result.status === "fulfilled"));
    await assertAccountRemoved(complete.userId, fixture.storagePath);
    createdUsers.delete(complete.userId);
    console.log("ok - complete synthetic Preview account cascade, Storage cleanup, old-JWT block, and concurrent retry");
  } finally {
    for (const userId of createdUsers) {
      await admin.storage.from("documents").remove(
        (await admin.storage.from("documents").list(userId, { limit: 100 })).data?.map((entry) => `${userId}/${entry.name}`) ?? [],
      ).catch(() => {});
      await admin.auth.admin.deleteUser(userId, false).catch(() => {});
    }
  }
}

await main();
