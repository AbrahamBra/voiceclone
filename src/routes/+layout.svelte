<script>
  import "../app.css";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken, isHydrated } from "$lib/stores/auth.js";
  import Toast from "$lib/components/Toast.svelte";

  let { children } = $props();

  $effect(() => {
    if (!$isHydrated) return;
    if ($page.url.pathname !== "/" && !$accessCode && !$sessionToken) {
      goto("/");
    }
  });
</script>

{#if $isHydrated}
  {@render children()}
{/if}
<Toast />
