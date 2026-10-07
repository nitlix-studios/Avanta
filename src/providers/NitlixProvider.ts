type Scope =
    | "id"
    | "profile"
    | "email"
    | "groups";

interface ScopeDataMap {
    "id": {
        /** The user's unique Nitlix ID. */
        id: string;
    };
    "profile": {
        /** The user's display name. */
        name: string;
        /**
         * URL to the user's avatar, or `null` if they haven't set one.
         *
         * Captured at sign-in, so it goes stale when the user changes their picture.
         */
        avatar: string | null;
        /** ISO 8601 timestamp of when the account was created. */
        createdAt: string;
    };
    "email": {
        /** The user's email address, or `null` if the account has none. */
        email: string | null;
    };
    "groups": {
        /** The access groups the user is a member of. */
        groups: {
            id: string;
            name: string;
        }[];
    };
}

type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends (k: infer I) => void
        ? I
        : never;

type DataForScopes<S extends readonly Scope[]> =
    UnionToIntersection<ScopeDataMap[S[number] & keyof ScopeDataMap]>;

/**
 * Nitlix sign-in.
 *
 * Not full OAuth2: there are no access or refresh tokens. The user comes back
 * with a one-time `ticket`, which is redeemed server to server for the data the
 * scopes unlock: a single request, and the ticket is burnt the moment it pays out.
 */
export default class NitlixProvider<const S extends readonly Scope[]> {
    private clientId: string;
    private clientSecret: string;
    private redirectUri: string;
    private scopes: S;
    private authServerUrl: string;

    constructor({
        clientId,
        clientSecret,
        redirectUri,
        scopes,
        authServerUrl = "https://nitlix.com",
    }: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        scopes: [...S];
        /** Origin of the Nitlix auth server. Defaults to `https://nitlix.com`. */
        authServerUrl?: string;
    }) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.scopes = scopes as S;
        this.authServerUrl = authServerUrl.trim().replace(/\/+$/, "");
    }

    /**
     * Build the URL to send the user to.
     *
     * Unlike the other providers, `state` is required: it's hashed into the ticket
     * and must be presented again to redeem it. Keep it somewhere the callback can
     * read it back (typically a short-lived cookie).
     */
    public getOAuthUrl(state: string): string {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            scope: JSON.stringify(this.scopes),
            state,
        });
        return `${this.authServerUrl}/auth?${params}`;
    }

    /**
     * Read the ticket out of a callback URL (or its search params).
     * Returns `null` if there isn't one.
     */
    public getTicket(callback: string | URL | URLSearchParams): string | null {
        const params =
            callback instanceof URLSearchParams
                ? callback
                : new URL(callback).searchParams;
        return params.get("ticket") ?? params.get("code");
    }

    /**
     * Redeem a ticket for the user's data via `POST /api/onelogin/peek`.
     *
     * Tickets are single-use and expire after 10 minutes, so call this exactly
     * once per callback. `state` must be the value passed to `getOAuthUrl()`.
     */
    public async getData({
        ticket,
        state,
    }: {
        ticket: string;
        state: string;
    }): Promise<DataForScopes<S>> {
        const res = await fetch(`${this.authServerUrl}/api/onelogin/peek`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ticket: ticket.trim(),
                state,
                clientId: this.clientId,
                clientSecret: this.clientSecret,
            }),
        });

        const text = await res.text();
        let body: { ok?: boolean; data?: unknown } | null = null;
        try {
            body = JSON.parse(text);
        } catch {}

        if (!res.ok || body?.ok !== true) {
            const reason = typeof body?.data === "string" ? body.data : text;
            throw new Error(`Failed to redeem ticket: ${reason || `HTTP ${res.status}`}`);
        }

        const data = body.data as Record<string, any>;

        return {
            ...(data.id !== undefined ? { id: data.id } : {}),
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
            ...(data.createdAt !== undefined ? { createdAt: data.createdAt } : {}),
            ...(data.email !== undefined ? { email: data.email } : {}),
            ...(data.groups !== undefined ? { groups: data.groups } : {}),
        } as DataForScopes<S>;
    }
}
