/** SteamID64 is a 17-digit decimal string in the 7656119… range. */
const STEAM64_RE = /^7656119\d{10}$/;

export function isSteamId64(value: string): boolean {
  return STEAM64_RE.test(value.trim());
}

/**
 * Extract a SteamID64 or vanity token from free-form user input
 * (raw id, profiles URL, id URL, or bare vanity).
 */
export function parseSteamInput(raw: string): { kind: "steamid64"; value: string } | { kind: "vanity"; value: string } {
  const s = raw.trim();
  if (!s) throw new Error("Steam ID or URL is required.");

  if (isSteamId64(s)) return { kind: "steamid64", value: s };

  try {
    const url = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "steamcommunity.com" || host.endsWith(".steamcommunity.com")) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "profiles" && parts[1] && isSteamId64(parts[1])) {
        return { kind: "steamid64", value: parts[1] };
      }
      if (parts[0] === "id" && parts[1]) {
        return { kind: "vanity", value: parts[1] };
      }
    }
  } catch {
    // not a URL
  }

  // Bare vanity: letters, digits, underscore, hyphen
  if (/^[A-Za-z0-9_-]{2,64}$/.test(s) && !/^\d+$/.test(s)) {
    return { kind: "vanity", value: s };
  }

  // Numeric but not steam64 — reject clearly
  if (/^\d+$/.test(s)) {
    throw new Error(`"${s}" is not a valid SteamID64 (expected 17 digits starting with 7656119).`);
  }

  throw new Error(`Could not parse Steam ID or URL from: ${s}`);
}

export type ResolveSteamOptions = {
  steamWebApiKey?: string;
  /** @deprecated CSRep is obsolete. Vanity resolution uses the Steam Web API only. */
  searchCsrep?: (query: string) => Promise<string | null>;
};

/**
 * Resolve free-form steam input to SteamID64.
 * Vanity resolution needs STEAM_WEB_API_KEY.
 */
export async function resolveSteamId64(raw: string, opts: ResolveSteamOptions = {}): Promise<string> {
  const parsed = parseSteamInput(raw);
  if (parsed.kind === "steamid64") return parsed.value;

  if (opts.steamWebApiKey) {
    const url = new URL("https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/");
    url.searchParams.set("key", opts.steamWebApiKey);
    url.searchParams.set("vanityurl", parsed.value);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Steam vanity resolve failed (${res.status}).`);
    const body = (await res.json()) as { response?: { success?: number; steamid?: string; message?: string } };
    if (body.response?.success === 1 && body.response.steamid && isSteamId64(body.response.steamid)) {
      return body.response.steamid;
    }
    throw new Error(`Steam vanity "${parsed.value}" not found.`);
  }

  if (opts.searchCsrep) {
    const id = await opts.searchCsrep(parsed.value);
    if (id && isSteamId64(id)) return id;
  }

  throw new Error(
    `Need a SteamID64 (or set STEAM_WEB_API_KEY to resolve vanity "${parsed.value}").`,
  );
}
