<script lang="ts">
  import { onMount } from "svelte";
  import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
  import type { OAuthSession } from "@atproto/oauth-client-browser";

  const API_URL =
    (import.meta.env.PUBLIC_AT_FUNCTIONS_API as string | undefined) ??
    "https://api.functions.at";
  const FUNCTIONS_COLLECTION = "at.functions.metadata";
  const WORKFLOW_COLLECTION = "at.functions.workflow";

  // OAuth coords — override via .env.local for local dev (e.g. with an ngrok tunnel)
  const OAUTH_CLIENT_ID =
    (import.meta.env.PUBLIC_OAUTH_CLIENT_ID as string | undefined) ??
    "https://functions.at/client-metadata.json";
  const OAUTH_REDIRECT_URI =
    (import.meta.env.PUBLIC_OAUTH_REDIRECT_URI as string | undefined) ??
    "https://functions.at/workflow";

  // ── OAuth client ───────────────────────────────────────────────────────────
  let oauthClient: BrowserOAuthClient | null = null;
  let session = $state<OAuthSession | null>(null);
  let did = $state("");
  let handle = $state("");
  let pdsUrl = $state("");

  let authLoading = $state(true);
  let authError = $state("");
  let loginHandle = $state("");
  let loginLoading = $state(false);

  function makeClient(): BrowserOAuthClient {
    const clientId = OAUTH_CLIENT_ID;
    const redirectUri = OAUTH_REDIRECT_URI;
    const clientUri = clientId.replace(/\/client-metadata\.json$/, "");

    return new BrowserOAuthClient({
      clientMetadata: {
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
      },
      handleResolver: "https://bsky.social",
    });
  }

  async function initAuth() {
    authLoading = true;
    authError = "";
    try {
      const client = makeClient();
      oauthClient = client;

      // Handle OAuth callback — params may arrive in the hash (#) or query string (?)
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const queryParams = new URLSearchParams(window.location.search);
      const params = hashParams.has("code") || hashParams.has("error") ? hashParams : queryParams;

      if (params.has("code") || params.has("error")) {
        try {
          const result = await client.callback(params);
          session = result.session;
          did = result.session.did;
          handle = await resolveHandle(did);
        } catch (e) {
          authError = e instanceof Error ? e.message : "OAuth callback failed";
        }
        // Clean URL (strip both hash and query string)
        window.history.replaceState({}, "", window.location.pathname);
      } else {
        // Try to restore existing session
        const restored = await client.restore(undefined).catch(() => null);
        if (restored) {
          session = restored;
          did = restored.did;
          handle = await resolveHandle(did);
        }
      }
    } catch (e) {
      authError = e instanceof Error ? e.message : String(e);
    } finally {
      authLoading = false;
    }
  }

  async function resolveHandle(repoDid: string): Promise<string> {
    try {
      const res = await fetch(
        `https://bsky.social/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(repoDid)}`,
      );
      const data = await res.json();
      // Extract and store PDS URL from the DID document
      const svcs: Array<{ id: string; serviceEndpoint: string }> = data?.didDoc?.service ?? [];
      const pds = svcs.find((s) => s.id === "#atproto_pds");
      if (pds?.serviceEndpoint) pdsUrl = pds.serviceEndpoint.replace(/\/$/, "");
      return data.handle ?? repoDid;
    } catch {
      return repoDid;
    }
  }

  async function signIn() {
    if (!oauthClient || !loginHandle.trim()) return;
    loginLoading = true;
    authError = "";
    try {
      const h = loginHandle.startsWith("@") ? loginHandle.slice(1) : loginHandle;
      const url = await oauthClient.authorize(h, { scope: "atproto transition:generic" });
      window.location.href = url.toString();
    } catch (e) {
      authError = e instanceof Error ? e.message : String(e);
      loginLoading = false;
    }
  }

  async function signOut() {
    if (session) {
      await session.signOut().catch(() => {});
    }
    session = null;
    did = "";
    handle = "";
    pdsUrl = "";
    myFunctions = [];
  }

  // ── Available functions ───────────────────────────────────────────────────
  interface FnMeta {
    uri: string;
    name: string;
    mode: string;
    version: string;
  }

  let myFunctions = $state<FnMeta[]>([]);
  let fnLoading = $state(false);

  async function loadMyFunctions() {
    if (!session) return;
    fnLoading = true;
    try {
      const res = await fetch(
        `https://bsky.social/xrpc/com.atproto.repo.listRecords` +
          `?repo=${encodeURIComponent(did)}&collection=${FUNCTIONS_COLLECTION}&limit=100`,
      );
      const data = await res.json();
      myFunctions = (data.records ?? []).map(
        (r: { uri: string; value: { name: string; mode: string; version: string } }) => ({
          uri: r.uri,
          name: r.value.name ?? r.uri.split("/").pop(),
          mode: r.value.mode ?? "?",
          version: r.value.version ?? "?",
        }),
      );
    } finally {
      fnLoading = false;
    }
  }

  $effect(() => {
    if (session && did) loadMyFunctions();
  });

  // ── Workflow builder state ─────────────────────────────────────────────────
  interface Step {
    id: string;
    functionUri: string;
    inputTemplate: string;
    description: string;
  }

  let wfName = $state("my-workflow");
  let wfVersion = $state("0.1.0");
  let wfDescription = $state("");
  let steps = $state<Step[]>([]);
  let saving = $state(false);
  let saveError = $state("");
  let savedUri = $state("");

  function addStep() {
    const id = `step${steps.length + 1}`;
    steps = [
      ...steps,
      {
        id,
        functionUri: myFunctions[0]?.uri ?? "",
        inputTemplate: "{}",
        description: "",
      },
    ];
  }

  function removeStep(idx: number) {
    steps = steps.filter((_, i) => i !== idx);
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= steps.length) return;
    const arr = [...steps];
    [arr[idx], arr[next]] = [arr[next]!, arr[idx]!];
    steps = arr;
  }

  // ── Test run ──────────────────────────────────────────────────────────────
  let testInput = $state("{}");
  let testRunning = $state(false);
  let testResult = $state<string | null>(null);
  let testError = $state<string | null>(null);

  async function testWorkflow() {
    if (!savedUri) return;
    testRunning = true;
    testResult = null;
    testError = null;
    try {
      let input: unknown = {};
      try { input = JSON.parse(testInput); } catch { throw new Error("Invalid JSON input"); }
      const res = await fetch(`${API_URL}/xrpc/at.functions.run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ function: savedUri, input }),
      });
      const data = await res.json();
      testResult = JSON.stringify(data, null, 2);
    } catch (e) {
      testError = e instanceof Error ? e.message : String(e);
    } finally {
      testRunning = false;
    }
  }

  // ── Save workflow ─────────────────────────────────────────────────────────
  function rkeyFromName(name: string) {
    return name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 64);
  }

  function buildRecord() {
    return {
      $type: WORKFLOW_COLLECTION,
      name: wfName.trim(),
      version: wfVersion.trim(),
      description: wfDescription.trim() || undefined,
      steps: steps.map((s) => {
        let input: unknown = {};
        try { input = JSON.parse(s.inputTemplate); } catch { /* keep {} */ }
        return {
          id: s.id.trim(),
          function: s.functionUri,
          input,
          description: s.description.trim() || undefined,
        };
      }),
      maxDurationMs: 120_000,
    };
  }

  async function saveWorkflow() {
    if (!session) return;
    saving = true;
    saveError = "";
    savedUri = "";
    try {
      const rkey = rkeyFromName(wfName);
      const endpoint = `${pdsUrl}/xrpc/com.atproto.repo.putRecord`;
      const res = await session.fetchHandler(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: did,
          collection: WORKFLOW_COLLECTION,
          rkey,
          record: buildRecord(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `putRecord failed (${res.status})`);
      }
      const data = await res.json();
      savedUri = (data as { uri?: string }).uri ?? `at://${did}/${WORKFLOW_COLLECTION}/${rkey}`;
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function invokeSnippet(uri: string) {
    return `curl -s -X POST ${API_URL}/xrpc/at.functions.run \\
  -H "Content-Type: application/json" \\
  -d '{"function":"${uri}","input":{}}'`;
  }

  let copiedSnippet = $state(false);
  async function copySnippet() {
    if (!savedUri) return;
    await navigator.clipboard.writeText(invokeSnippet(savedUri));
    copiedSnippet = true;
    setTimeout(() => (copiedSnippet = false), 1500);
  }

  onMount(() => { void initAuth(); });
</script>

<svelte:head>
  <title>Workflow Builder — AT Functions</title>
  <link rel="canonical" href="https://functions.at/workflow" />
</svelte:head>

<div class="page dark">
  <div class="col">
    <header>
      <a href="/" class="back">← AT Functions</a>
      <span class="page-title">Workflow Builder</span>
    </header>

    {#if authLoading}
      <p class="muted">Loading…</p>

    {:else if !session}
      <!-- Sign in -->
      <section class="panel">
        <h2 class="section-title">Sign in with AT Proto</h2>
        <p class="hint">You'll be redirected to your PDS to authorise access — no passwords shared with this app.</p>
        <div class="login-row">
          <input
            class="field"
            type="text"
            placeholder="you.bsky.social"
            bind:value={loginHandle}
            spellcheck="false"
            autocomplete="username"
            onkeydown={(e) => e.key === "Enter" && signIn()}
          />
          <button class="btn-primary" onclick={signIn} disabled={loginLoading || !loginHandle.trim()}>
            {loginLoading ? "Redirecting…" : "Continue →"}
          </button>
        </div>
        {#if authError}
          <p class="err">{authError}</p>
        {/if}
      </section>

    {:else}
      <!-- Authenticated -->
      <div class="session-bar">
        <span class="session-handle">@{handle || did}</span>
        <button class="btn-ghost" onclick={signOut}>Sign out</button>
      </div>

      <!-- Workflow metadata -->
      <section class="panel">
        <h2 class="section-title">Workflow details</h2>
        <div class="form-row">
          <label class="field-wrap">
            <span class="label">Name</span>
            <input class="field" type="text" bind:value={wfName} spellcheck="false" />
          </label>
          <label class="field-wrap narrow">
            <span class="label">Version</span>
            <input class="field" type="text" bind:value={wfVersion} spellcheck="false" />
          </label>
        </div>
        <label class="field-wrap">
          <span class="label">Description</span>
          <input class="field" type="text" bind:value={wfDescription} placeholder="Optional" spellcheck="false" />
        </label>
      </section>

      <!-- Steps -->
      <section class="panel">
        <h2 class="section-title">Steps</h2>

        {#if steps.length === 0}
          <p class="hint">No steps yet. Add a function below to start building your chain.</p>
        {/if}

        {#each steps as step, i}
          <div class="step-card">
            <div class="step-header">
              <span class="step-num">Step {i + 1}</span>
              <div class="step-actions">
                <button class="btn-ghost small" onclick={() => moveStep(i, -1)} disabled={i === 0}>↑</button>
                <button class="btn-ghost small" onclick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>↓</button>
                <button class="btn-ghost small danger" onclick={() => removeStep(i)}>Remove</button>
              </div>
            </div>

            <div class="form-row">
              <label class="field-wrap narrow">
                <span class="label">Step ID</span>
                <input class="field mono" type="text" bind:value={step.id} spellcheck="false" />
              </label>
              <label class="field-wrap">
                <span class="label">Function</span>
                {#if fnLoading}
                  <input class="field" type="text" placeholder="Loading…" disabled />
                {:else}
                  <select class="field" bind:value={step.functionUri}>
                    {#each myFunctions as fn}
                      <option value={fn.uri}>{fn.name} <span>({fn.mode})</span></option>
                    {/each}
                  </select>
                {/if}
              </label>
            </div>

            <label class="field-wrap">
              <span class="label">
                Input JSON
                <span class="hint-inline">
                  {#if i === 0}
                    ref workflow input with <code>{"{{$.input.field}}"}</code>
                  {:else}
                    ref prev step with <code>{"{{$." + (steps[i - 1]?.id ?? "prev") + ".field}}"}</code>
                  {/if}
                </span>
              </span>
              <textarea
                class="field mono"
                rows={4}
                bind:value={step.inputTemplate}
                spellcheck="false"
              ></textarea>
            </label>

            <label class="field-wrap">
              <span class="label">Description (optional)</span>
              <input class="field" type="text" bind:value={step.description} spellcheck="false" />
            </label>
          </div>
        {/each}

        <button class="btn-add" onclick={addStep}>
          + Add step
        </button>
      </section>

      <!-- Save -->
      <section class="panel">
        <h2 class="section-title">Save to AT Proto</h2>
        <p class="hint mono-sm">at://{did}/{WORKFLOW_COLLECTION}/{rkeyFromName(wfName)}</p>
        <button class="btn-primary" onclick={saveWorkflow} disabled={saving || steps.length === 0}>
          {saving ? "Saving…" : "Save workflow"}
        </button>
        {#if saveError}
          <p class="err">{saveError}</p>
        {/if}

        {#if savedUri}
          <div class="saved-box">
            <p class="saved-ok">✓ Saved</p>
            <code class="saved-uri">{savedUri}</code>
            <div class="snippet-wrap">
              <pre class="snippet">{invokeSnippet(savedUri)}</pre>
              <button class="copy-btn" onclick={copySnippet}>
                {copiedSnippet ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div class="test-wrap">
            <h3 class="section-title">Test run</h3>
            <label class="field-wrap">
              <span class="label">Input JSON</span>
              <textarea class="field mono" rows={3} bind:value={testInput} spellcheck="false"></textarea>
            </label>
            <button class="btn-primary" onclick={testWorkflow} disabled={testRunning}>
              {testRunning ? "Running…" : "Run workflow"}
            </button>
            {#if testError}
              <pre class="response error">{testError}</pre>
            {:else if testResult}
              <pre class="response">{testResult}</pre>
            {/if}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  /* ── Theme (always dark for now, matches main app default) ── */
  .page {
    --bg: #0a0a0a;
    --surface: #0d0d0d;
    --border: #1e1e1e;
    --border-hover: #333;
    --text: #e8e8e8;
    --text-2: #aaa;
    --muted: #666;
    --snippet-bg: #161616;
    --snippet-text: #aaa;
    --copy-bg: #1e1e1e;
    --copy-hover: #2a2a2a;
    --input-bg: #111;
    --step-bg: #0f0f0f;
    --code-bg: #1e1e1e;

    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    display: flex;
    justify-content: center;
    padding: 0 1.5rem;
  }

  .col {
    width: 100%;
    max-width: 680px;
    padding-bottom: 6rem;
  }

  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 3rem 0 2rem;
  }

  .back {
    font-size: 0.82rem;
    color: var(--muted);
    text-decoration: none;
    transition: color 0.15s;
  }
  .back:hover { color: var(--text); }

  .page-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text);
  }

  /* ── Panel ── */
  .panel {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.25rem 1.4rem;
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .section-title {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin: 0;
  }

  /* ── Auth ── */
  .login-row {
    display: flex;
    gap: 0.6rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .session-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0 0.5rem;
  }

  .session-handle {
    font-size: 0.82rem;
    color: var(--text-2);
    font-family: monospace;
  }

  /* ── Form ── */
  .form-row {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .field-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    flex: 1;
    min-width: 0;
  }
  .field-wrap.narrow { flex: 0 0 140px; }

  .label {
    font-size: 0.72rem;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .hint-inline {
    font-size: 0.68rem;
    font-style: italic;
    color: var(--muted);
  }

  .field {
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
    padding: 0.5rem 0.65rem;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .field:focus { border-color: var(--border-hover); }
  .field:disabled { opacity: 0.4; cursor: default; }
  .field.mono { font-family: monospace; font-size: 0.78rem; resize: vertical; }
  select.field { cursor: pointer; }

  /* ── Steps ── */
  .step-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.1rem;
    background: var(--step-bg);
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  .step-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .step-num {
    font-size: 0.72rem;
    font-weight: 700;
    font-family: monospace;
    color: var(--muted);
  }

  .step-actions { display: flex; gap: 0.3rem; }

  /* ── Buttons ── */
  .btn-primary {
    background: #e8e8e8;
    border: none;
    border-radius: 7px;
    color: #0a0a0a;
    font-size: 0.82rem;
    font-family: inherit;
    font-weight: 700;
    padding: 0.55em 1.2em;
    cursor: pointer;
    transition: background 0.15s;
    align-self: flex-start;
    white-space: nowrap;
  }
  .btn-primary:hover:not(:disabled) { background: #fff; }
  .btn-primary:disabled { opacity: 0.35; cursor: default; }

  .btn-ghost {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-2);
    font-size: 0.78rem;
    font-family: inherit;
    padding: 0.3em 0.8em;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .btn-ghost:hover:not(:disabled) { border-color: var(--border-hover); color: var(--text); }
  .btn-ghost.small { padding: 0.2em 0.55em; font-size: 0.72rem; }
  .btn-ghost.danger:hover { color: #f87171; border-color: #7f1d1d; }
  .btn-ghost:disabled { opacity: 0.3; cursor: default; }

  .btn-add {
    background: transparent;
    border: 1px dashed var(--border-hover);
    border-radius: 8px;
    color: var(--text-2);
    font-size: 0.82rem;
    font-family: inherit;
    padding: 0.65em 1em;
    cursor: pointer;
    width: 100%;
    transition: border-color 0.15s, color 0.15s;
  }
  .btn-add:hover { border-color: var(--text-2); color: var(--text); }

  /* ── Saved ── */
  .saved-box {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .saved-ok {
    font-size: 0.78rem;
    font-weight: 700;
    color: #4ade80;
    margin: 0;
  }

  .saved-uri {
    font-family: monospace;
    font-size: 0.7rem;
    color: var(--text-2);
    word-break: break-all;
  }

  .snippet-wrap {
    border-radius: 7px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .snippet {
    background: var(--snippet-bg);
    color: var(--snippet-text);
    font-family: monospace;
    font-size: 0.7rem;
    line-height: 1.6;
    margin: 0;
    padding: 0.65rem 0.75rem;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .copy-btn {
    display: block;
    width: 100%;
    background: var(--copy-bg);
    border: none;
    border-top: 1px solid var(--border);
    color: var(--text-2);
    font-size: 0.72rem;
    font-family: inherit;
    padding: 0.35em 0.75rem;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }
  .copy-btn:hover { background: var(--copy-hover); }

  /* ── Test run ── */
  .test-wrap {
    border-top: 1px solid var(--border);
    padding-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  .response {
    background: var(--snippet-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--snippet-text);
    font-family: monospace;
    font-size: 0.72rem;
    line-height: 1.6;
    margin: 0;
    padding: 0.6rem 0.75rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 320px;
    overflow-y: auto;
  }
  .response.error { color: #f87171; border-color: #7f1d1d; background: transparent; }

  /* ── Misc ── */
  .hint {
    font-size: 0.8rem;
    color: var(--text-2);
    margin: 0;
    line-height: 1.5;
  }

  .mono-sm {
    font-family: monospace;
    font-size: 0.72rem;
    color: var(--muted);
    margin: 0;
    word-break: break-all;
  }

  .muted { color: var(--muted); font-size: 0.85rem; padding: 2rem 0; }
  .err { font-size: 0.8rem; color: #f87171; margin: 0; }

  code {
    background: var(--code-bg);
    border-radius: 4px;
    padding: 0.1em 0.35em;
    font-family: monospace;
    font-size: 0.85em;
  }
</style>
