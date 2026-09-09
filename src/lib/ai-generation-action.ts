export async function runReservedAiGeneration<T, TReservation, TResult = T>({
  reserve,
  generate,
  afterGenerate,
  finish,
}: {
  reserve: () => Promise<TReservation>;
  generate: () => Promise<T>;
  afterGenerate?: (result: T) => Promise<TResult>;
  finish: (reservation: TReservation, status: "succeeded" | "failed") => Promise<void>;
}): Promise<TResult> {
  const reservation = await reserve();
  let providerReturned = false;
  let finalizationAttempted = false;

  try {
    const result = await generate();
    providerReturned = true;
    const completedResult = afterGenerate ? await afterGenerate(result) : result as unknown as TResult;
    finalizationAttempted = true;
    await finish(reservation, "succeeded");
    return completedResult;
  } catch (error) {
    if (!finalizationAttempted) {
      await finish(reservation, providerReturned ? "succeeded" : "failed").catch(() => undefined);
    }
    throw error;
  }
}
