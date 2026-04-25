<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Browse and run WebAssembly functions published on the AT Protocol." />
  <meta name="author" content="functions.at" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://functions.at" />
  <meta property="og:title" content="AT Functions" />
  <meta property="og:description" content="Browse and run WebAssembly functions published on the AT Protocol." />
  <meta property="og:site_name" content="functions.at" />

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="AT Functions" />
  <meta name="twitter:description" content="Browse and run WebAssembly functions published on the AT Protocol." />
</svelte:head>

{@render children()}
