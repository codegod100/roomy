<script lang="ts">
  let { children } = $props();
</script>

<!-- Events/Room Content -->
<main
  class="flex flex-col gap-4 p-4 grow min-w-0 h-full overflow-clip bg-base-100"
>
  {@render children()}
</main>
