<script>
  import "../app.css";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken, isHydrated } from "$lib/stores/auth.js";
  import Toast from "$lib/components/Toast.svelte";

  let { children } = $props();

  $effect(() => {
    if (!$isHydrated) return;
    const pub =
      $page.url.pathname === "/" ||
      $page.url.pathname === "/guide" ||
      $page.url.pathname === "/demo" ||
      $page.url.pathname === "/login" ||
      $page.url.pathname === "/lab";
    if (!pub && !$accessCode && !$sessionToken) {
      goto("/login");
    }
  });
</script>

{#if $isHydrated}
  {@render children()}
{/if}
<Toast />
