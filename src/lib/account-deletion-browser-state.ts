export function clearNexaBrowserState(): void {
  if (typeof window === "undefined") return;

  for (const storage of [window.localStorage, window.sessionStorage]) {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith("nexa:")) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  }
}
