import NitlixProvider from "../src/providers/NitlixProvider";

const provider = new NitlixProvider({
    clientId: "1234567890",
    clientSecret: "1234567890",
    redirectUri: "https://example.com/auth/callback",
    scopes: ["id", "email"],
});

const url = provider.getOAuthUrl("state");

const ticket = provider.getTicket("https://example.com/auth/callback?ticket=id.code");

const e = await provider.getData({ ticket: ticket!, state: "state" });

e.id;
e.email;
// @ts-expect-error — `profile` scope not requested
e.name;
