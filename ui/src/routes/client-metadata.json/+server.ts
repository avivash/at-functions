import { json } from "@sveltejs/kit";

export const prerender = true;

export function GET() {
  const clientId =
    (import.meta.env.PUBLIC_OAUTH_CLIENT_ID as string | undefined) ||
    "https://functions.at/client-metadata.json";
  const redirectUri =
    (import.meta.env.PUBLIC_OAUTH_REDIRECT_URI as string | undefined) ||
    "https://functions.at/workflow";
  const clientUri = clientId.replace(/\/client-metadata\.json$/, "");

  return json({
    client_id: clientId,
    client_name: "AT Functions",
    client_uri: clientUri,
    logo_uri: `${clientUri}/favicon.svg`,
    redirect_uris: [redirectUri],
    scope: "atproto transition:generic",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  });
}
