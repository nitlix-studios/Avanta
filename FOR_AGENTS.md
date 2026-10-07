# Avanta — Implementation & Extension Guide

This document is for AI agents and contributors who need to deeply understand Avanta's internals, add new providers, or modify existing ones.

## Architecture overview

```
src/
├── exports.ts                    # Default export aggregating all providers
├── util/
│   └── TokenStore.ts             # Token persistence and refresh utility
└── providers/
    ├── DiscordProvider.ts         # Discord OAuth2 + scope-dependent actions
    ├── GitHubProvider.ts          # GitHub OAuth2 (App or OAuth App)
    ├── GoogleProvider.ts          # Google OAuth2 (OpenID Connect)
    ├── MicrosoftProvider.ts       # Microsoft Identity Platform v2.0
    ├── NitlixProvider.ts          # Nitlix ticket sign-in (no tokens)
    └── TwitchProvider.ts          # Twitch OAuth2 (Helix API)
```

The library has **zero runtime dependencies**. It uses only the Fetch API and standard Web APIs. TypeScript is the only peer dependency (for `.d.ts` generation).

Build output goes to `dist/` via `tsc`. The package ships ESM only (`"type": "module"`).

## Core concepts

### Provider pattern

Every provider is a standalone class with a generic `<const S extends readonly Scope[]>` parameter. The `const` modifier is critical — it causes TypeScript to infer the literal tuple type of the scopes array, enabling precise return type narrowing.

Each provider implements:

```
constructor({ clientId, clientSecret, redirectUri, scopes })
getOAuthUrl(state?) → string
getTokens(code) → Promise<RawTokenResponse>
getTokenStore(code) → Promise<TokenStore>
refreshTokens(tokenStore) → Promise<RawTokenResponse>
refreshTokenStore(tokenStore) → Promise<TokenStore>
getData(tokenStore) → Promise<DataForScopes<S>>
```

### Scope-to-type mapping

The type system works through three layers:

1. **`Scope`** — a union of string literal types representing valid scopes for the provider.

2. **`ScopeDataMap`** — an interface mapping each scope to the data fields it unlocks:
   ```ts
   interface ScopeDataMap {
       "identify": { id: string; username: string; /* ... */ };
       "email": { email: string; verified: boolean; };
       "guilds": { guilds: Array<{ /* ... */ }> };
   }
   ```

3. **`DataForScopes<S>`** — a computed type that intersects the relevant entries from `ScopeDataMap` based on the scopes tuple `S`, plus always includes `tokenStore: TokenStore`:
   ```ts
   type UnionToIntersection<U> =
       (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

   type DataForScopes<S extends readonly Scope[]> = UnionToIntersection<
       ScopeDataMap[S[number] & keyof ScopeDataMap]
   > & { tokenStore: TokenStore };
   ```

The `UnionToIntersection` utility converts `ScopeDataMap["identify"] | ScopeDataMap["email"]` into `ScopeDataMap["identify"] & ScopeDataMap["email"]`, giving the caller a single flat object type with all the fields from every requested scope.

### TokenStore

`TokenStore` is a simple class holding three values:

- `access_token: string`
- `refresh_token: string`
- `access_token_expires_at: number` (milliseconds since epoch)

It provides:

- `.compress` — getter that returns `JSON.stringify(...)` of the three fields. Intended for database/cookie storage.
- `TokenStore.extract(json)` — static factory that parses the JSON and returns a new `TokenStore`.

All fields default to empty/zero if not provided in the constructor.

### Auto-refresh

Every provider's `getData()` checks `tokenStore.access_token_expires_at < Date.now()` before making API calls. If expired, it calls `refreshTokenStore()` internally and uses the new token for the request. The returned data always includes the (possibly refreshed) `tokenStore` so the caller can persist it.

## Provider internals

### DiscordProvider

**OAuth endpoints:**
- Authorize: `https://discord.com/api/oauth2/authorize`
- Token: `https://discord.com/api/oauth2/token`
- User data: `https://discord.com/api/v10/users/@me`
- Guilds: `https://discord.com/api/v10/users/@me/guilds`
- Connections: `https://discord.com/api/v10/users/@me/connections`

**Data fetching strategy:**
- Always calls `/users/@me` (covers `identify` and `email` scopes).
- Conditionally calls `/users/@me/guilds` if `guilds` scope is present.
- Conditionally calls `/users/@me/connections` if `connections` scope is present.
- All calls are made in parallel via `Promise.all`.

**Scope-dependent actions:**

Discord is the only provider with an `actions` property. The actions are populated in the constructor based on the scope set:

- `guilds.join` scope → `actions.guilds.join({ guildId, tokenStore, botToken, options? })` — uses `PUT /guilds/{guild.id}/members/@me` with a bot token.
- `guilds.members.read` scope → `actions.guilds.members.read({ guildId, tokenStore })` — uses `GET /users/@me/guilds/{guild.id}/member`.

The `ActionsForScopes<S>` type uses an `ActionMap` interface that maps scope names to nested action object shapes. The `ScopeToAction` conditional type extracts relevant entries, and `UnionToIntersection` merges them.

Actions auto-refresh tokens before making requests and return `{ tokenStore, data }`.

### GitHubProvider

**OAuth endpoints:**
- Authorize: `https://github.com/login/oauth/authorize`
- Token: `https://github.com/login/oauth/access_token`
- User data: `https://api.github.com/user`
- Emails: `https://api.github.com/user/emails`
- Orgs: `https://api.github.com/user/orgs`

**Special considerations:**
- GitHub's token endpoint returns errors in the response body (status 200) rather than as HTTP errors. The provider checks for `data.error` and throws accordingly.
- GitHub Apps with token expiration disabled return tokens that never expire (`expires_in` is absent). In this case, `access_token_expires_at` is set to `Number.MAX_SAFE_INTEGER` and `refresh_token` is empty.
- `refreshTokens()` throws if no refresh token is available.
- Data calls are made sequentially (not in parallel) for each scope.
- Uses `Accept: application/vnd.github+json` header for API calls.

### GoogleProvider

**OAuth endpoints:**
- Authorize: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- User data: `https://www.googleapis.com/oauth2/v3/userinfo`

**Special considerations:**
- Scopes are URL-prefixed when building the OAuth URL: each scope `s` becomes `https://www.googleapis.com/auth/${s}`.
- OAuth URL always includes `access_type=offline` and `prompt=consent` to ensure a refresh token is returned.
- All scopes map to a single endpoint (`/userinfo`), so only one API call is needed.
- Google's refresh endpoint does not return a new refresh token — the existing one is preserved.

### MicrosoftProvider

**OAuth endpoints:**
- Authorize: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
- Token: `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- User data: `https://graph.microsoft.com/v1.0/me`
- Organization: `https://graph.microsoft.com/v1.0/me/organization`
- Avatar: `https://graph.microsoft.com/v1.0/me/photo/$value`

**Special considerations:**
- Uses Microsoft Graph API v1.0.
- `offline_access` scope is required for refresh tokens — it maps to no data fields in `ScopeDataMap`.
- The refresh token request includes the full scope string (unlike other providers).
- Organization data fetch is wrapped in a try/catch — personal Microsoft accounts may not have organization info and the endpoint returns an error.
- The `avatarUrl` field is a static URL that requires the access token to fetch. It's not a direct image URL.

### TwitchProvider

**OAuth endpoints:**
- Authorize: `https://id.twitch.tv/oauth2/authorize`
- Token: `https://id.twitch.tv/oauth2/token`
- User data: `https://api.twitch.tv/helix/users`

**Special considerations:**
- Twitch always returns base profile data (`BaseUserData`) regardless of scopes. The `ScopeDataMap` only adds `email` for the `user:read:email` scope.
- The `DataForScopes` type is `BaseUserData & UnionToIntersection<...> & { tokenStore }`.
- API calls require both `Authorization: Bearer` and `Client-Id` headers.
- The user data endpoint returns `{ data: [...] }` — the provider reads `data[0]`.

### NitlixProvider

**Endpoints** (relative to `authServerUrl`, default `https://nitlix.com`):
- Authorize: `/auth`
- Redeem ticket: `POST /api/onelogin/peek`

**Special considerations:**
- **Not OAuth2.** No token exchange, no refresh, no `TokenStore`. The class deliberately breaks the common provider shape: it only has `getOAuthUrl(state)`, `getTicket(callback)` and `getData({ ticket, state })`.
- `state` is required. The auth server hashes it into the ticket and rejects the redeem (`Invalid state`) unless the same value is sent back.
- The callback carries `?ticket=<id>.<code>` (read `code` as a fallback). Tickets are single-use — deleted on the first successful peek — and expire after 10 minutes.
- `scope` is sent as a JSON array, which every version of the auth server accepts.
- The peek body is `{ ticket, state, clientId, clientSecret }` as JSON and the response is `{ ok, data }`; on `ok: false`, `data` is the reason string, which is what gets thrown.
- There is no base profile: `DataForScopes` is purely the intersection of the requested scopes (`id`, `profile`, `email`, `groups`).

## How to add a new provider

### 1. Create the provider file

Create `src/providers/<Name>Provider.ts`. Use this template:

```ts
import TokenStore from "../util/TokenStore";

type Scope =
    | "scope_one"
    | "scope_two";

interface ScopeDataMap {
    "scope_one": {
        // Fields returned by scope_one
        field: string;
    };
    "scope_two": {
        // Fields returned by scope_two
        otherField: number;
    };
}

type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends (k: infer I) => void
        ? I
        : never;

type DataForScopes<S extends readonly Scope[]> = UnionToIntersection<
    ScopeDataMap[S[number] & keyof ScopeDataMap]
> & {
    tokenStore: TokenStore;
};

export default class NewProvider<const S extends readonly Scope[]> {
    private clientId: string;
    private clientSecret: string;
    private redirectUri: string;
    private scopes: S;

    constructor({
        clientId,
        clientSecret,
        redirectUri,
        scopes,
    }: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        scopes: [...S];
    }) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.scopes = scopes as S;
    }

    public getOAuthUrl(state?: string): string {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: "code",
            scope: (this.scopes as readonly string[]).join(" "),
        });
        if (state) params.set("state", state);
        return `https://provider.example.com/oauth/authorize?${params}`;
    }

    public async getTokens(code: string) {
        const res = await fetch("https://provider.example.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: "authorization_code",
                code,
                redirect_uri: this.redirectUri,
            }),
        });
        if (!res.ok) throw new Error(`Failed to get tokens: ${await res.text()}`);
        return res.json() as Promise<{
            access_token: string;
            token_type: string;
            expires_in: number;
            refresh_token: string;
            scope: string;
        }>;
    }

    public async getTokenStore(code: string) {
        const res = await this.getTokens(code);
        return new TokenStore({
            access_token: res.access_token,
            refresh_token: res.refresh_token,
            access_token_expires_at: Date.now() + res.expires_in * 1000,
        });
    }

    public async refreshTokens(tokenStore: TokenStore) {
        const res = await fetch("https://provider.example.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: "refresh_token",
                refresh_token: tokenStore.refresh_token,
            }),
        });
        if (!res.ok) throw new Error(`Failed to refresh tokens: ${await res.text()}`);
        return res.json() as Promise<{
            access_token: string;
            token_type: string;
            expires_in: number;
            refresh_token: string;
            scope: string;
        }>;
    }

    public async refreshTokenStore(tokenStore: TokenStore) {
        const res = await this.refreshTokens(tokenStore);
        return new TokenStore({
            access_token: res.access_token,
            refresh_token: res.refresh_token,
            access_token_expires_at: Date.now() + res.expires_in * 1000,
        });
    }

    public async getData(tokenStore: TokenStore): Promise<DataForScopes<S>> {
        if (tokenStore.access_token_expires_at < Date.now()) {
            tokenStore = await this.refreshTokenStore(tokenStore);
        }

        const headers = { Authorization: `Bearer ${tokenStore.access_token}` };
        const scopeSet = new Set(this.scopes);
        const merged: any = {};

        if (scopeSet.has("scope_one")) {
            const res = await fetch("https://api.provider.example.com/user", { headers });
            if (!res.ok) throw new Error(`Failed to fetch user data: ${await res.text()}`);
            Object.assign(merged, await res.json());
        }

        if (scopeSet.has("scope_two")) {
            const res = await fetch("https://api.provider.example.com/other", { headers });
            if (!res.ok) throw new Error(`Failed to fetch other data: ${await res.text()}`);
            merged.otherField = (await res.json()).value;
        }

        return { tokenStore, ...merged };
    }
}
```

### 2. Register the provider in exports

Add to `src/exports.ts`:

```ts
import NewProvider from "./providers/NewProvider";

export default {
    // ...existing providers
    NewProvider,
};
```

### 3. Conventions to follow

- **`const` generic**: Always use `<const S extends readonly Scope[]>` and `scopes: [...S]` in the constructor to preserve literal types.
- **`ScopeDataMap`**: Every scope must have a corresponding entry. Use `{}` for scopes that don't return data (like `offline_access`).
- **Auto-refresh**: Always check `tokenStore.access_token_expires_at < Date.now()` at the top of `getData()` and call `refreshTokenStore()` if expired.
- **Return `tokenStore`**: The `tokenStore` must always be in the return value of `getData()` (and actions, if any) so the caller can persist refreshed tokens.
- **Error handling**: Throw `Error` with the response body text on non-OK responses. Don't silently swallow errors.
- **No dependencies**: Use only `fetch` and standard Web APIs. Don't import external packages.

### 4. Scope-dependent actions (optional)

If the provider has scopes that enable actions (like Discord's `guilds.join`), follow the Discord pattern:

1. Define an `ActionMap` interface mapping scopes to their action objects.
2. Define `ScopeToAction<U>` and `ActionsForScopes<S>` types.
3. Add a public `actions` property on the class.
4. Populate the actions object in the constructor based on the scope set.
5. Each action should auto-refresh tokens and return `{ tokenStore, data }`.

## Build and publish

- **Build**: `bunx tsc` (compiles to `dist/`)
- **Publish**: Automated via GitHub Actions on push to `main`. The workflow runs `bun install`, `bunx tsc`, then `npm publish --provenance --access public`.
- **Package files**: Only `dist/` is included in the published package (configured via `"files"` in `package.json`).

## Testing

Tests live in the `tests/` directory and are excluded from the TypeScript build via `tsconfig.json`.
