<script lang="ts">
  import { toast } from "svelte-french-toast";
  import { Channel, WikiPage } from "@roomy-chat/sdk";
  import { globalState } from "$lib/global.svelte";
  import Dialog from "./Dialog.svelte";
  import { focusOnRender } from "$lib/actions/useFocusOnRender.svelte";

  let {
    triggerStyle = "dz-btn dz-btn-primary dz-btn-sm text-lg",
  }: {
    triggerStyle?: string;
  } = $props();

  let isPageTitleDialogOpen = $state(false);
  let newPageTitleElement: HTMLInputElement | null = $state(null);

  export function createPage() {
    if (newPageTitleElement) {
      newPageTitleElement.value = "";
    }
    isPageTitleDialogOpen = true;
  }

  async function submitPageTitle() {
    if (
      !globalState.space ||
      !globalState.channel ||
      !(globalState.channel instanceof Channel)
    )
      return;
    if (!newPageTitleElement) {
      toast.error("Title cannot be empty", { position: "bottom-end" });
      return;
    }
    const newPageTitle = newPageTitleElement.value; // Retrieve the title from the input element
    // Create a temporary page with the provided title
    const pg = await globalState.space.create(WikiPage);

    isPageTitleDialogOpen = false;

    try {
      pg.name = newPageTitle;

      globalState.channel.wikipages.push(pg);
      globalState.channel?.commit();

      globalState.space.wikipages.push(pg);
      globalState.space.commit();
      pg.commit();
    } catch (e) {
      console.error("Error creating page", e);
      toast.error("Failed to create page", { position: "bottom-end" });
    }
  }
</script>

<button class={triggerStyle} onclick={createPage}> + </button>
<Dialog
  title="New Page"
  description="Give your new page a title"
  bind:isDialogOpen={isPageTitleDialogOpen}
>
  <form onsubmit={submitPageTitle} class="flex flex-col gap-4">
    <input
      type="text"
      bind:this={newPageTitleElement}
      use:focusOnRender
      placeholder="Tips on moderation..."
      class="dz-input dz-input-bordered w-full"
      required
    />
    <div class="flex justify-end gap-3 mt-2">
      <button type="submit" class="dz-btn dz-btn-primary">Create</button>
    </div>
  </form>
</Dialog>
