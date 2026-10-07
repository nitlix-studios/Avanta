<div align="center">
  <img src="assets/avanta.webp" alt="Avanta">

<br /> 
<h1>Avanta</h1>

  <h3>OAuth that does more with less.<br />Scope-aware providers with fully typed user data, zero config.</h3>

  <a href="https://github.com/nitlix-hq/Avanta">
    <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/nitlix-hq/Avanta?style=social">
  </a>

  <a href="https://www.npmjs.com/package/avanta">
    <img alt="npm version" src="https://img.shields.io/npm/v/avanta.svg">
  </a>
  <a href="https://www.npmjs.com/package/avanta">
    <img alt="weekly downloads" src="https://img.shields.io/npm/dm/avanta.svg">
  </a>
</div>

<br />

## Intro

Avanta is a super-lightweight (sub 100kB) TypeScript-first OAuth library for teams who want **prebuilt providers** with **full type safety** and **zero framework lock-in**.

If you like the convenience of **NextAuth** or **Lucia**, but want something that:

- gives you **full control** over the OAuth flow (no magic, no sessions, no database)
- returns **scope-aware typed data** (request `email` and `guilds`? the return type includes exactly those fields)
- uses only the **Fetch API** (works in Bun, Node 18+, Deno, Cloudflare Workers)
- has **zero dependencies**

Avanta is a good fit.

It gives you:

- **6 prebuilt providers**: Discord, GitHub, Google, Microsoft, Nitlix, Twitch, and more to come
- **Scope-level typing**: the data you get back is typed to the exact scopes you requested
- **Token management**: `TokenStore` with built-in refresh, serialization, and expiry tracking
- **Scope-dependent actions**: Discord's `guilds.join` and `guilds.members.read` are only available when you request those scopes

## Table of contents

- [Quickstart](#quickstart)
- [Providers](#providers)
    - [Discord](#discord)
    - [GitHub](#github)
    - [Google](#google)
    - [Microsoft](#microsoft)
    - [Twitch](#twitch)
    - [Nitlix](#nitlix)
- [TokenStore](#tokenstore)
- [Common API](#common-api)
- [Scope-dependent actions (Discord)](#scope-dependent-actions-discord)
- [Framework examples](#framework-examples)
- [API reference](#api-reference)
- [Contributor docs](#contributor-docs)
- [License](#license)

## Quickstart

Install:

```sh
bun add avanta
```

Other package managers:

```sh
pnpm add avanta
npm i avanta
```

### 1) Create a provider

Every provider takes the same shape: `clientId`, `clientSecret`, `redirectUri`, and `scopes`. The scopes you pass in determine the return type of `getData()`.

```ts
import Avanta from "avanta";

const discord = new Avanta.DiscordProvider({
    clientId: process.env.DISCORD_CLIENT_ID!,
    clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    redirectUri: "http://localhost:3000/auth/discord/callback",
    scopes: ["identify", "email", "guilds"],
});
```

### 2) Redirect the user to the OAuth page

Generate the authorization URL and redirect the user to it. You can optionally pass a `state` parameter for CSRF protection.

```ts
const url = discord.getOAuthUrl("random-state-string");
// Redirect the user to `url`
```

### 3) Exchange the code for tokens

When the user is redirected back, exchange the authorization code for a `TokenStore`:

```ts
const tokenStore = await discord.getTokenStore(code);
```

The `TokenStore` holds the access token, refresh token, and expiry timestamp. You can serialize it to JSON for storage:

```ts
const serialized = tokenStore.compress(); // JSON string
```

And restore it later:

```ts
import { TokenStore } from "avanta"; // or from the util path
const restored = TokenStore.extract(serialized);
```

### 4) Fetch user data

Call `getData()` with the token store. The return type is **automatically narrowed** to the scopes you configured:

```ts
const data = await discord.getData(tokenStore);

// Because we requested ["identify", "email", "guilds"]:
data.username; // string     (from "identify")
data.email; // string     (from "email")
data.guilds; // Array<...> (from "guilds")
data.tokenStore; // TokenStore (always present, may be refreshed)
```

If a scope wasn't requested, the field doesn't exist on the type — no runtime checks needed.

## Providers

All providers share the same constructor shape and public API. The only differences are the available scopes and the shape of the returned data.

### Discord

```ts
const discord = new Avanta.DiscordProvider({
    clientId: "...",
    clientSecret: "...",
    redirectUri: "...",
    scopes: ["identify", "email", "guilds", "connections"],
});
```

**Available scopes:**

| Scope                    | Data returned                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `identify`               | `id`, `username`, `avatar`, `discriminator`, `global_name`, `banner`, `accent_color`, `locale`, `mfa_enabled`, `premium_type`, `public_flags` |
| `email`                  | `email`, `verified`                                                                                                                           |
| `guilds`                 | `guilds` (array of partial guild objects)                                                                                                     |
| `connections`            | `connections` (array of connection objects)                                                                                                   |
| `guilds.join`            | Enables `actions.guilds.join(...)`                                                                                                            |
| `guilds.members.read`    | Enables `actions.guilds.members.read(...)`                                                                                                    |
| `gdm.join`               | Group DM join capability                                                                                                                      |
| `role_connections.write` | Role connection metadata write                                                                                                                |
| `dm_channels.read`       | DM channel read access                                                                                                                        |

### GitHub

```ts
const github = new Avanta.GitHubProvider({
    clientId: "...",
    clientSecret: "...",
    redirectUri: "...",
    scopes: ["read:user", "user:email", "read:org"],
});
```

**Available scopes:**

| Scope        | Data returned                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read:user`  | `login`, `id`, `node_id`, `avatar_url`, `html_url`, `name`, `company`, `blog`, `location`, `bio`, `twitter_username`, `public_repos`, `public_gists`, `followers`, `following`, `created_at`, `updated_at` |
| `user:email` | `emails` (array with `email`, `primary`, `verified`, `visibility`)                                                                                                                                         |
| `read:org`   | `orgs` (array with `login`, `id`, `node_id`, `avatar_url`, `description`)                                                                                                                                  |

> **Note:** GitHub only issues refresh tokens when token expiration is enabled on the GitHub App. If your app doesn't have token expiration, `refreshTokens()` will throw.

### Google

```ts
const google = new Avanta.GoogleProvider({
    clientId: "...",
    clientSecret: "...",
    redirectUri: "...",
    scopes: ["openid", "profile", "email"],
});
```

**Available scopes:**

| Scope     | Data returned                                            |
| --------- | -------------------------------------------------------- |
| `openid`  | `sub` (stable Google account ID)                         |
| `profile` | `name`, `given_name`, `family_name`, `picture`, `locale` |
| `email`   | `email`, `email_verified`                                |

Google's OAuth URL automatically requests `offline` access and `consent` prompt for refresh token support.

### Microsoft

```ts
const microsoft = new Avanta.MicrosoftProvider({
    clientId: "...",
    clientSecret: "...",
    redirectUri: "...",
    scopes: ["User.Read", "Organization.Read.All", "offline_access"],
});
```

**Available scopes:**

| Scope                   | Data returned                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User.Read`             | `id`, `displayName`, `givenName`, `surname`, `mail`, `userPrincipalName`, `jobTitle`, `officeLocation`, `businessPhones`, `mobilePhone`, `preferredLanguage`, `avatarUrl` |
| `Organization.Read.All` | `organization` (object with `id`, `displayName`, address fields, `verifiedDomains`, or `null` for personal accounts)                                                      |
| `offline_access`        | Enables refresh tokens (no data fields)                                                                                                                                   |

> **Note:** The `avatarUrl` field requires the access token to fetch the actual image bytes. Personal Microsoft accounts may have `mail` as `null` — use `userPrincipalName` as a fallback.

### Twitch

```ts
const twitch = new Avanta.TwitchProvider({
    clientId: "...",
    clientSecret: "...",
    redirectUri: "...",
    scopes: ["user:read:email"],
});
```

Twitch always returns base profile data regardless of scopes:

| Field               | Description                                               |
| ------------------- | --------------------------------------------------------- |
| `id`                | Unique Twitch numeric ID (as string)                      |
| `login`             | Lowercase login name                                      |
| `display_name`      | Case-preserved display name                               |
| `type`              | Account type (`""`, `"admin"`, `"staff"`, `"global_mod"`) |
| `broadcaster_type`  | `""`, `"affiliate"`, or `"partner"`                       |
| `description`       | Channel bio                                               |
| `profile_image_url` | Profile image URL                                         |
| `offline_image_url` | Offline stream image URL                                  |
| `created_at`        | ISO 8601 account creation date                            |

**Additional scopes:**

| Scope             | Data returned |
| ----------------- | ------------- |
| `user:read:email` | `email`       |

### Nitlix

Nitlix sign-in is a ticket flow rather than full OAuth2: there are no access or refresh tokens and no `TokenStore`. The user comes back with a one-time `ticket`, which you redeem for their data in a single server-to-server request.

```ts
const nitlix = new Avanta.NitlixProvider({
    clientId: process.env.NITLIX_CLIENT_ID!,
    clientSecret: process.env.NITLIX_CLIENT_SECRET!,
    redirectUri: "https://example.com/auth/callback",
    scopes: ["id", "profile"],
});

// 1) Redirect. `state` is required — keep it (e.g. in a cookie) for the callback.
const url = nitlix.getOAuthUrl(state);

// 2) Callback. Redeem the ticket against the same state.
const ticket = nitlix.getTicket(request.url);
const data = await nitlix.getData({ ticket, state });
// data.id, data.name, data.avatar, data.createdAt
```

| Scope     | Fields added                                            |
| --------- | ------------------------------------------------------- |
| `id`      | `id`                                                    |
| `profile` | `name`, `avatar` (`string \| null`), `createdAt` (ISO)  |
| `email`   | `email` (`string \| null`)                              |
| `groups`  | `groups` (`{ id, name }[]`)                             |

Tickets are single-use and expire after 10 minutes — call `getData()` exactly once per callback (watch out for React StrictMode double-invoking effects). It throws with the auth server's reason (`Invalid ticket`, `Invalid state`, ...) on failure.

Pass `authServerUrl` to the constructor to point at a different Nitlix instance (defaults to `https://nitlix.com`).

## TokenStore

`TokenStore` is a small utility class that holds OAuth tokens and manages serialization.

```ts
import Avanta from "avanta";

// Created automatically by getTokenStore()
const tokenStore = await provider.getTokenStore(code);

// Properties
tokenStore.access_token; // string
tokenStore.refresh_token; // string
tokenStore.access_token_expires_at; // number (ms since epoch)

// Serialize to JSON string (for database storage, cookies, etc.)
const json = tokenStore.compress();

// Restore from JSON string
const restored = TokenStore.extract(json);
```

When you call `getData()`, Avanta **automatically refreshes** the access token if it has expired. The returned `data.tokenStore` may be a new instance with fresh tokens — always persist the returned token store.

```ts
const data = await discord.getData(tokenStore);

// IMPORTANT: persist the (possibly refreshed) token store
await db.user.update({
    where: { id: userId },
    data: { tokens: data.tokenStore.compress() },
});
```

## Common API

Every provider exposes the same methods:

| Method                          | Description                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `getOAuthUrl(state?)`           | Returns the full authorization URL. Pass an optional `state` string for CSRF protection. |
| `getTokens(code)`               | Exchanges an authorization code for raw token data (provider-specific shape).            |
| `getTokenStore(code)`           | Exchanges a code for a `TokenStore` (recommended over `getTokens`).                      |
| `refreshTokens(tokenStore)`     | Refreshes the access token using the refresh token. Returns raw token data.              |
| `refreshTokenStore(tokenStore)` | Refreshes and returns a new `TokenStore`.                                                |
| `getData(tokenStore)`           | Fetches all user data for the configured scopes. Auto-refreshes expired tokens.          |

## Scope-dependent actions (Discord)

Discord's provider exposes an `actions` object whose methods are typed based on the scopes you requested.

### `guilds.join` — Join a user to a guild

Requires the `guilds.join` scope **and** a bot token with `CREATE_INSTANT_INVITE` permission in the target guild.

```ts
const discord = new Avanta.DiscordProvider({
    clientId: "...",
    clientSecret: "...",
    redirectUri: "...",
    scopes: ["identify", "guilds.join"],
});

const result = await discord.actions.guilds.join({
    guildId: "123456789",
    tokenStore,
    botToken: process.env.DISCORD_BOT_TOKEN!,
    options: {
        nick: "New Member",
        roles: ["role-id-1"],
        mute: false,
        deaf: false,
    },
});
// result.data is the guild member object (or null if already a member)
// result.tokenStore is the (possibly refreshed) token store
```

### `guilds.members.read` — Read guild member data

Requires the `guilds.members.read` scope.

```ts
const discord = new Avanta.DiscordProvider({
    clientId: "...",
    clientSecret: "...",
    redirectUri: "...",
    scopes: ["identify", "guilds.members.read"],
});

const result = await discord.actions.guilds.members.read({
    guildId: "123456789",
    tokenStore,
});
// result.data is the guild member object
```

If you don't request these scopes, `discord.actions` won't have these methods at the type level — TypeScript prevents you from calling them.

## Framework examples

### Next.js (App Router)

```ts
// app/auth/discord/route.ts
import Avanta from "avanta";

const discord = new Avanta.DiscordProvider({
    clientId: process.env.DISCORD_CLIENT_ID!,
    clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    redirectUri: "http://localhost:3000/auth/discord/callback",
    scopes: ["identify", "email"],
});

export async function GET() {
    const url = discord.getOAuthUrl();
    return Response.redirect(url);
}
```

```ts
// app/auth/discord/callback/route.ts
export async function GET(req: Request) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code")!;

    const tokenStore = await discord.getTokenStore(code);
    const data = await discord.getData(tokenStore);

    // data.username, data.email, data.tokenStore
    // Store in your database, set a session cookie, etc.

    return Response.redirect("/dashboard");
}
```

### Express / Bun / any `Request`-based server

```ts
import Avanta from "avanta";

const github = new Avanta.GitHubProvider({
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    redirectUri: "http://localhost:3000/auth/github/callback",
    scopes: ["read:user", "user:email"],
});

// Redirect route
app.get("/auth/github", (req, res) => {
    res.redirect(github.getOAuthUrl());
});

// Callback route
app.get("/auth/github/callback", async (req, res) => {
    const code = req.query.code as string;
    const tokenStore = await github.getTokenStore(code);
    const data = await github.getData(tokenStore);

    // data.login, data.emails, data.tokenStore
    res.json({ user: data.login, emails: data.emails });
});
```

## API reference

### Exports

The default export is an object containing all providers:

```ts
import {
    DiscordProvider,
    GitHubProvider,
    GoogleProvider,
    MicrosoftProvider,
    NitlixProvider,
    TwitchProvider,
} from "avanta";
```

### Provider constructor

All providers accept the same options:

```ts
{
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: [...Scope[]]; // const tuple — drives return type inference
}
```

### `TokenStore`

| Property / Method          | Type                  | Description                                     |
| -------------------------- | --------------------- | ----------------------------------------------- |
| `access_token`             | `string`              | The current access token                        |
| `refresh_token`            | `string`              | The refresh token (empty string if unavailable) |
| `access_token_expires_at`  | `number`              | Expiry as ms since epoch                        |
| `compress()`               | `string`              | JSON-serialized token data                      |
| `compressed`               | `string` (getter)     | Alias for `compress()`                          |
| `TokenStore.extract(json)` | `TokenStore` (static) | Deserialize from JSON string                    |

## Contributor docs

- **Implementation + extension guide**: [`FOR_AGENTS.md`](FOR_AGENTS.md)

## License

MIT
