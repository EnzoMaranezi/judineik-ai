export const ACCOUNT_REAUTHENTICATION_REQUIRED = "ACCOUNT_REAUTHENTICATION_REQUIRED";
export const ACCOUNT_DELETION_UNAVAILABLE = "ACCOUNT_DELETION_UNAVAILABLE";

const STORAGE_PAGE_SIZE = 100;
const STORAGE_DELETE_BATCH_SIZE = 100;
const MAX_STORAGE_CLEANUP_PASSES = 8;

export type DeletionStatus = "pending" | "storage_cleared" | "auth_deleting";

export type StorageEntry = {
  id: string | null;
  name: string;
};

export type AccountDeletionStorage = {
  list: (prefix: string, options: { limit: number; offset: number }) => Promise<StorageEntry[]>;
  remove: (paths: string[]) => Promise<void>;
};

export type AccountDeletionDependencies = {
  begin: () => Promise<DeletionStatus>;
  storage: AccountDeletionStorage;
  updateStatus: (status: DeletionStatus) => Promise<void>;
  deleteAuthUser: () => Promise<"deleted" | "already_missing">;
};

export async function listAccountStorageObjects(
  storage: AccountDeletionStorage,
  userId: string,
): Promise<string[]> {
  const files: string[] = [];
  const directories = [userId];

  while (directories.length > 0) {
    const prefix = directories.shift()!;
    let offset = 0;

    for (;;) {
      const entries = await storage.list(prefix, { limit: STORAGE_PAGE_SIZE, offset });
      for (const entry of entries) {
        const path = `${prefix}/${entry.name}`;
        if (entry.id === null) directories.push(path);
        else files.push(path);
      }
      if (entries.length < STORAGE_PAGE_SIZE) break;
      offset += entries.length;
    }
  }

  return files;
}

export async function clearAccountStorage(
  storage: AccountDeletionStorage,
  userId: string,
): Promise<void> {
  let emptyPasses = 0;

  for (let pass = 0; pass < MAX_STORAGE_CLEANUP_PASSES; pass += 1) {
    const files = await listAccountStorageObjects(storage, userId);
    if (files.length === 0) {
      emptyPasses += 1;
      if (emptyPasses === 2) return;
      continue;
    }

    emptyPasses = 0;
    for (let index = 0; index < files.length; index += STORAGE_DELETE_BATCH_SIZE) {
      await storage.remove(files.slice(index, index + STORAGE_DELETE_BATCH_SIZE));
    }
  }

  throw new Error(ACCOUNT_DELETION_UNAVAILABLE);
}

export async function executeAccountDeletion(
  userId: string,
  dependencies: AccountDeletionDependencies,
): Promise<{ deleted: true }> {
  await dependencies.begin();
  await clearAccountStorage(dependencies.storage, userId);
  await dependencies.updateStatus("storage_cleared");

  // Close the small gap between the first empty confirmation and Auth deletion.
  await clearAccountStorage(dependencies.storage, userId);
  await dependencies.updateStatus("auth_deleting");
  await dependencies.deleteAuthUser();

  return { deleted: true };
}

export function assertTrustedAccountDeletionRequest(request: Request): void {
  if (request.method !== "POST") throw new Error(ACCOUNT_DELETION_UNAVAILABLE);

  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    throw new Error(ACCOUNT_DELETION_UNAVAILABLE);
  }

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new Error(ACCOUNT_DELETION_UNAVAILABLE);
  }
}
