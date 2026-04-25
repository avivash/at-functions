<script lang="ts">
  import { onMount } from "svelte";

  const SERVICE = "https://bsky.social";
  const API_URL = "https://api.functions.at";
  const DEFAULT_HANDLE = "hamburgerz.bsky.social";

  type Mode = "pure-v1" | "host-v1" | "component-v1";

  interface FunctionRecord {
    name: string;
    version: string;
    description?: string;
    mode: Mode;
    maxMemoryMb?: number;
    maxDurationMs?: number;
  }

  interface FunctionResult {
    uri: string;
    cid: string;
    value: FunctionRecord;
    did: string;
  }

  let query = $state("");
  let all = $state<FunctionResult[]>([]);
  let loading = $state(false);
  let error = $state("");
  let dark = $state(true);
  let modeFilter = $state<Mode | "all">("all");
  let copiedUri = $state<string | null>(null);

  // Per-card playground state
  let playgrounds = $state<
    Record<
      string,
      {
        open: boolean;
        input: string;
        running: boolean;
        response: string | null;
        error: string | null;
      }
    >
  >({});

  function pgState(uri: string) {
    return playgrounds[uri];
  }

  let results = $derived(
    all.filter((fn) => {
      const matchesMode = modeFilter === "all" || fn.value.mode === modeFilter;
      const matchesQuery =
        !query.trim() ||
        fn.value.name?.toLowerCase().includes(query.toLowerCase()) ||
        fn.value.mode?.toLowerCase().includes(query.toLowerCase()) ||
        fn.uri.toLowerCase().includes(query.toLowerCase());
      return matchesMode && matchesQuery;
    }),
  );

  async function resolveHandle(handle: string): Promise<string> {
    const h = handle.startsWith("@") ? handle.slice(1) : handle;
    const res = await fetch(
      `${SERVICE}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(h)}`,
    );
    if (!res.ok) throw new Error(`Could not resolve "${h}"`);
    return (await res.json()).did;
  }

  async function fetchFunctions(
    handleOrDid: string,
  ): Promise<FunctionResult[]> {
    const did = handleOrDid.startsWith("did:")
      ? handleOrDid
      : await resolveHandle(handleOrDid);
    const res = await fetch(
      `${SERVICE}/xrpc/com.atproto.repo.listRecords` +
        `?repo=${encodeURIComponent(did)}&collection=at.functions.metadata&limit=100`,
    );
    if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
    const data = await res.json();
    return (data.records ?? []).map(
      (r: { uri: string; cid: string; value: FunctionRecord }) => ({
        uri: r.uri,
        cid: r.cid,
        value: r.value,
        did,
      }),
    );
  }

  async function load() {
    loading = true;
    error = "";
    try {
      all = await fetchFunctions(DEFAULT_HANDLE);
      for (const fn of all) {
        if (!playgrounds[fn.uri]) {
          playgrounds[fn.uri] = {
            open: false,
            input: "{}",
            running: false,
            response: null,
            error: null,
          };
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function runFunction(uri: string) {
    const pg = pgState(uri);
    pg.running = true;
    pg.response = null;
    pg.error = null;
    try {
      let input: unknown = {};
      try {
        input = JSON.parse(pg.input);
      } catch {
        throw new Error("Invalid JSON input");
      }
      const res = await fetch(`${API_URL}/xrpc/at.functions.run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ function: uri, input }),
      });
      const data = await res.json();
      pg.response = JSON.stringify(data, null, 2);
    } catch (e) {
      pg.error = e instanceof Error ? e.message : String(e);
    } finally {
      pg.running = false;
    }
  }

  function clear() {
    query = "";
  }
  function toggleTheme() {
    dark = !dark;
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") clear();
  }

  async function copy(text: string, uri: string) {
    await navigator.clipboard.writeText(text);
    copiedUri = uri;
    setTimeout(() => (copiedUri = null), 1500);
  }

  function invokeSnippet(uri: string) {
    return `curl -s -X POST ${API_URL}/xrpc/at.functions.run \\
  -H "Content-Type: application/json" \\
  -d '{"function":"${uri}","input":{}}'`;
  }

  const modeBadge: Record<Mode, string> = {
    "pure-v1": "pure",
    "host-v1": "host",
    "component-v1": "component",
  };

  const filters: { value: Mode | "all"; label: string }[] = [
    { value: "all", label: "All" },
    { value: "pure-v1", label: "pure" },
    { value: "host-v1", label: "host" },
    { value: "component-v1", label: "component" },
  ];

  function rkey(uri: string) {
    return uri.split("/").at(-1) ?? uri;
  }

  onMount(load);
</script>

<svelte:head>
  <title>AT Functions</title>
  <link rel="canonical" href="https://functions.at" />
</svelte:head>

<div class="page" class:dark class:light={!dark}>
  <div class="col">
    <header>
      <span class="wordmark">AT Functions</span>
      <button
        class="theme-toggle"
        onclick={toggleTheme}
        aria-label="Toggle theme"
      >
        {#if dark}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          >
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
              stroke-linecap="round"
            />
          </svg>
        {:else}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          >
            <path
              d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        {/if}
      </button>
    </header>

    <div class="search-wrap">
      <svg
        class="icon-search"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      >
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="M15 15l-3-3" stroke-linecap="round" />
      </svg>
      <input
        type="text"
        placeholder="Search..."
        bind:value={query}
        onkeydown={onKeydown}
        spellcheck="false"
        autocomplete="off"
      />
      {#if query}
        <button class="btn-icon" onclick={clear} aria-label="Clear">×</button>
      {/if}
      <button class="btn-icon btn-arrow" aria-label="Go" disabled>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path
            d="M4 10h12M11 5l5 5-5 5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>

    <!-- Mode filters -->
    {#if all.length > 0}
      <div class="filters">
        {#each filters as f}
          <button
            class="filter-btn"
            class:active={modeFilter === f.value}
            class:filter-pure={f.value === "pure-v1"}
            class:filter-host={f.value === "host-v1"}
            class:filter-component={f.value === "component-v1"}
            onclick={() => (modeFilter = f.value)}>{f.label}</button
          >
        {/each}
      </div>
    {/if}

    {#if error}
      <p class="msg err">{error}</p>
    {:else if loading}
      <p class="msg muted">Loading…</p>
    {:else if results.length === 0}
      <p class="msg muted">No functions found.</p>
    {:else}
      <div class="grid">
        {#each results as fn}
          {@const pg = playgrounds[fn.uri]}
          <div class="card">
            <!-- Top row -->
            <div class="card-top">
              <span class="name">{fn.value.name ?? rkey(fn.uri)}</span>
              <span class="version">v{fn.value.version ?? "?"}</span>
              <span class="badge mode-{fn.value.mode}">
                {modeBadge[fn.value.mode] ?? fn.value.mode}
              </span>
            </div>

            {#if fn.value.description}
              <p class="desc">{fn.value.description}</p>
            {/if}

            <!-- Curl snippet -->
            <div class="snippet-wrap">
              <pre class="snippet">{invokeSnippet(fn.uri)}</pre>
              <button
                class="copy-btn"
                onclick={() => copy(invokeSnippet(fn.uri), fn.uri)}
              >
                {copiedUri === fn.uri ? "✓ Copied" : "Copy"}
              </button>
            </div>

            <!-- Playground toggle -->
            <button class="pg-toggle" onclick={() => (pg.open = !pg.open)}>
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                class:rotated={pg.open}
              >
                <path
                  d="M4 6l4 4 4-4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              {pg.open ? "Close playground" : "Run in playground"}
            </button>

            {#if pg.open}
              <div class="playground">
                <label class="pg-label">Input JSON</label>
                <textarea
                  class="pg-input"
                  bind:value={pg.input}
                  rows={4}
                  spellcheck="false"
                  autocomplete="off"
                ></textarea>
                <button
                  class="pg-run"
                  onclick={() => runFunction(fn.uri)}
                  disabled={pg.running}
                >
                  {pg.running ? "Running…" : "Run"}
                </button>
                {#if pg.error}
                  <div class="pg-response error">{pg.error}</div>
                {:else if pg.response}
                  <div class="pg-label">Response</div>
                  <pre class="pg-response">{pg.response}</pre>
                {/if}
              </div>
            {/if}

            <span class="uri">{fn.uri}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  /* ── Themes ── */
  .dark {
    --bg: #0a0a0a;
    --surface: #0d0d0d;
    --border: #2a2a2a;
    --border-card: #1e1e1e;
    --border-hover: #333;
    --text: #e8e8e8;
    --text-2: #aaa;
    --muted: #666;
    --icon: #555;
    --placeholder: #444;
    --uri-color: #444;
    --desc-color: #999;
    --snippet-bg: #161616;
    --snippet-text: #aaa;
    --copy-bg: #1e1e1e;
    --copy-hover: #2a2a2a;
    --filter-bg: #161616;
    --filter-active-bg: #2a2a2a;
    --pg-bg: #111;
    --pg-input-bg: #161616;
    --pg-run-bg: #1e1e1e;
    --pg-run-hover: #2a2a2a;
    --pg-resp-bg: #0d0d0d;
  }

  .light {
    --bg: #ffffff;
    --surface: #ffffff;
    --border: #e8e8e8;
    --border-card: #ebebeb;
    --border-hover: #c8c8c8;
    --text: #111111;
    --text-2: #555;
    --muted: #888;
    --icon: #bbb;
    --placeholder: #bbb;
    --uri-color: #aaa;
    --desc-color: #555;
    --snippet-bg: #f5f5f5;
    --snippet-text: #555;
    --copy-bg: #ebebeb;
    --copy-hover: #e0e0e0;
    --filter-bg: #f5f5f5;
    --filter-active-bg: #e8e8e8;
    --pg-bg: #fafafa;
    --pg-input-bg: #ffffff;
    --pg-run-bg: #ebebeb;
    --pg-run-hover: #e0e0e0;
    --pg-resp-bg: #f5f5f5;
  }

  /* ── Layout ── */
  .page {
    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    display: flex;
    justify-content: center;
    padding: 0 1.5rem;
    transition:
      background 0.2s,
      color 0.2s;
  }

  .col {
    width: 100%;
    max-width: 720px;
    padding-bottom: 6rem;
  }

  /* ── Header ── */
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3rem 0 1.5rem;
  }

  .wordmark {
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }

  .theme-toggle {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--icon);
    display: flex;
    align-items: center;
    padding: 0.3rem;
    border-radius: 6px;
    transition: color 0.15s;
  }
  .theme-toggle:hover {
    color: var(--text);
  }
  .theme-toggle svg {
    width: 18px;
    height: 18px;
  }

  /* ── Search ── */
  .search-wrap {
    display: flex;
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0 0.5rem 0 1rem;
    gap: 0.25rem;
    margin-bottom: 1rem;
  }

  .icon-search {
    width: 16px;
    height: 16px;
    color: var(--icon);
    flex-shrink: 0;
  }

  input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 0.95rem;
    font-family: inherit;
    padding: 0.85rem 0.5rem;
  }
  input::placeholder {
    color: var(--placeholder);
  }

  .btn-icon {
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.4rem;
    border-radius: 6px;
    color: var(--icon);
    flex-shrink: 0;
    transition: color 0.1s;
    font-size: 1.1rem;
    line-height: 1;
  }
  .btn-arrow svg {
    width: 16px;
    height: 16px;
  }
  .btn-icon:hover:not(:disabled) {
    color: var(--text);
  }
  .btn-icon:disabled {
    opacity: 0.3;
    cursor: default;
  }

  /* ── Filters ── */
  .filters {
    display: flex;
    gap: 0.4rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }

  .filter-btn {
    background: var(--filter-bg);
    border: 1px solid var(--border-card);
    border-radius: 20px;
    color: var(--text-2);
    font-size: 0.75rem;
    font-family: monospace;
    font-weight: 600;
    padding: 0.25em 0.8em;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
  }

  .filter-btn:hover {
    border-color: var(--border-hover);
    color: var(--text);
  }

  .filter-btn.active {
    color: var(--text);
    border-color: var(--border-hover);
    background: var(--filter-active-bg);
  }

  /* Active mode-specific colours */
  .dark .filter-btn.active.filter-pure {
    background: #1e3a5f;
    border-color: #1e3a5f;
    color: #60a5fa;
  }
  .dark .filter-btn.active.filter-host {
    background: #3d2a00;
    border-color: #3d2a00;
    color: #fbbf24;
  }
  .dark .filter-btn.active.filter-component {
    background: #2d1b4e;
    border-color: #2d1b4e;
    color: #c084fc;
  }

  .light .filter-btn.active.filter-pure {
    background: #dbeafe;
    border-color: #bfdbfe;
    color: #1d4ed8;
  }
  .light .filter-btn.active.filter-host {
    background: #fef3c7;
    border-color: #fde68a;
    color: #b45309;
  }
  .light .filter-btn.active.filter-component {
    background: #ede9fe;
    border-color: #ddd6fe;
    color: #7c3aed;
  }

  /* ── Messages ── */
  .msg {
    margin: 0 0 1rem;
    font-size: 0.85rem;
  }
  .muted {
    color: var(--muted);
  }
  .err {
    color: #f87171;
  }

  /* ── Grid ── */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 0.75rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border-card);
    border-radius: 10px;
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    transition: border-color 0.15s;
  }
  .card:hover {
    border-color: var(--border-hover);
  }

  .card-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .name {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }

  .version {
    font-size: 0.75rem;
    font-family: monospace;
    color: var(--text-2);
  }

  .badge {
    font-size: 0.65rem;
    font-family: monospace;
    font-weight: 600;
    padding: 0.2em 0.45em;
    border-radius: 4px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .dark .mode-pure-v1 {
    background: #1e3a5f;
    color: #60a5fa;
  }
  .dark .mode-host-v1 {
    background: #3d2a00;
    color: #fbbf24;
  }
  .dark .mode-component-v1 {
    background: #2d1b4e;
    color: #c084fc;
  }

  .light .mode-pure-v1 {
    background: #dbeafe;
    color: #1d4ed8;
  }
  .light .mode-host-v1 {
    background: #fef3c7;
    color: #b45309;
  }
  .light .mode-component-v1 {
    background: #ede9fe;
    color: #7c3aed;
  }

  .desc {
    font-size: 0.82rem;
    color: var(--desc-color);
    margin: 0;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── Snippet ── */
  .snippet-wrap {
    border-radius: 7px;
    overflow: hidden;
    border: 1px solid var(--border-card);
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
    border-top: 1px solid var(--border-card);
    color: var(--text-2);
    font-size: 0.72rem;
    font-family: inherit;
    padding: 0.35em 0.75rem;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }
  .copy-btn:hover {
    background: var(--copy-hover);
  }

  /* ── Playground toggle ── */
  .pg-toggle {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    border: none;
    color: var(--text-2);
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    padding: 0;
    transition: color 0.1s;
  }
  .pg-toggle:hover {
    color: var(--text);
  }
  .pg-toggle svg {
    width: 14px;
    height: 14px;
    transition: transform 0.2s;
  }
  .pg-toggle svg.rotated {
    transform: rotate(180deg);
  }

  /* ── Playground ── */
  .playground {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--pg-bg);
    border: 1px solid var(--border-card);
    border-radius: 8px;
    padding: 0.75rem;
  }

  .pg-label {
    font-size: 0.72rem;
    color: var(--muted);
    font-family: monospace;
  }

  .pg-input {
    background: var(--pg-input-bg);
    border: 1px solid var(--border-card);
    border-radius: 6px;
    color: var(--text);
    font-family: monospace;
    font-size: 0.78rem;
    line-height: 1.5;
    padding: 0.5rem 0.6rem;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
  }
  .pg-input:focus {
    border-color: var(--border-hover);
  }

  .pg-run {
    align-self: flex-start;
    background: var(--pg-run-bg);
    border: 1px solid var(--border-card);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.78rem;
    font-family: inherit;
    font-weight: 600;
    padding: 0.3em 0.9em;
    cursor: pointer;
    transition: background 0.1s;
  }
  .pg-run:hover:not(:disabled) {
    background: var(--pg-run-hover);
  }
  .pg-run:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .pg-response {
    background: var(--pg-resp-bg);
    border: 1px solid var(--border-card);
    border-radius: 6px;
    color: var(--snippet-text);
    font-family: monospace;
    font-size: 0.72rem;
    line-height: 1.6;
    margin: 0;
    padding: 0.5rem 0.6rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
  }

  .pg-response.error {
    color: #f87171;
    border-color: #7f1d1d;
    background: transparent;
  }

  /* ── AT URI ── */
  .uri {
    font-family: monospace;
    font-size: 0.68rem;
    color: var(--uri-color);
    word-break: break-all;
  }
</style>
