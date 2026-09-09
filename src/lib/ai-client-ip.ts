import { isIP } from "node:net";

export type NormalizedClientIp = {
  address: string;
  family: 4 | 6;
};

function normalizeIpv4(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    return octet <= 255 ? octet : null;
  });
  if (octets.some((octet) => octet === null)) return null;
  return octets.join(".");
}

function ipv6Groups(value: string): number[] | null {
  let candidate = value.toLowerCase();
  if (candidate.includes(".")) {
    const separator = candidate.lastIndexOf(":");
    if (separator < 0) return null;
    const ipv4 = normalizeIpv4(candidate.slice(separator + 1));
    if (!ipv4) return null;
    const octets = ipv4.split(".").map(Number);
    candidate = `${candidate.slice(0, separator)}:${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }

  if ((candidate.match(/::/g) ?? []).length > 1) return null;
  const [leftRaw, rightRaw] = candidate.split("::");
  const parseSide = (side: string | undefined) =>
    side ? side.split(":").map((group) => /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : NaN) : [];
  const left = parseSide(leftRaw);
  const right = parseSide(rightRaw);
  if ([...left, ...right].some(Number.isNaN)) return null;

  if (candidate.includes("::")) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    return [...left, ...Array<number>(missing).fill(0), ...right];
  }
  return left.length === 8 ? left : null;
}

function formatIpv6(groups: number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }

  if (bestStart < 0) return groups.map((group) => group.toString(16)).join(":");
  const left = groups.slice(0, bestStart).map((group) => group.toString(16)).join(":");
  const right = groups.slice(bestStart + bestLength).map((group) => group.toString(16)).join(":");
  if (!left && !right) return "::";
  if (!left) return `::${right}`;
  if (!right) return `${left}::`;
  return `${left}::${right}`;
}

export function normalizeClientIp(value: string): NormalizedClientIp | null {
  const candidate = value.trim();
  if (!candidate || candidate.includes(",") || candidate.includes("%") || candidate.includes("[") || candidate.includes("]")) {
    return null;
  }

  if (isIP(candidate) === 4) {
    const address = normalizeIpv4(candidate);
    return address ? { address, family: 4 } : null;
  }
  if (isIP(candidate) !== 6) return null;

  const groups = ipv6Groups(candidate);
  if (!groups || groups.length !== 8) return null;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return {
      address: `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`,
      family: 4,
    };
  }
  return { address: formatIpv6(groups), family: 6 };
}

export function trustedClientIpFromHeaders(headers: Headers): NormalizedClientIp | null {
  const forwarded = headers.get("x-vercel-forwarded-for");
  return forwarded ? normalizeClientIp(forwarded) : null;
}
