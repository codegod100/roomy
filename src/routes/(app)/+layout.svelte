<script lang="ts">
  import "../../app.css";
  import "$lib/tiptap/tiptap-styles.css";
  import "$lib/sidebar-scroll.css";
  import { onMount } from "svelte";
  import { dev } from "$app/environment";
  import { g } from "$lib/global.svelte";
  import { user } from "$lib/user.svelte";
  import { cleanHandle, derivePromise, navigate } from "$lib/utils.svelte";

  // Track active tooltip for scroll updates
  let activeTooltip: HTMLElement | null = null;
  let activeButton: HTMLElement | null = null;

  import Icon from "@iconify/svelte";
  import Dialog from "$lib/components/Dialog.svelte";
  import AvatarImage from "$lib/components/AvatarImage.svelte";

  import { Toaster } from "svelte-french-toast";
  import { AvatarMarble } from "svelte-boring-avatars";
  import { Avatar, Button, ToggleGroup, ScrollArea } from "bits-ui";

  import ThemeSelector from "$lib/components/ThemeSelector.svelte";
  import { Space } from "@roomy-chat/sdk";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import { RenderScan } from "svelte-render-scan";

  let { children } = $props();

  let handleInput = $state("");
  let loginLoading = $state(false);
  let isLoginDialogOpen = $state(!user.session);

  let newSpaceName = $state("");
  let isNewSpaceDialogOpen = $state(false);

  // Create a state variable to trigger refresh
  let spacesRefreshTrigger = $state(0);

  // Function to manually refresh spaces
  function refreshSpaces() {
    spacesRefreshTrigger++;
    console.log("Manually refreshing spaces...");
  }

  let spaces = derivePromise([], async () => {
    // Use the trigger in the effect to force re-evaluation
    spacesRefreshTrigger;
    const items = (await g.roomy?.spaces.items()) || [];
    console.log("Loaded spaces:", items.length, items);
    return items;
  });

  onMount(() => {
    user.init();

    // Add scroll event listener to update tooltip position
    const scrollArea = document.querySelector(".space-list-scroll");
    const scrollViewport = document.querySelector(".bits-scroll-area-viewport");

    if (scrollArea) {
      scrollArea.addEventListener("scroll", updateTooltipPosition);
    }

    if (scrollViewport) {
      scrollViewport.addEventListener("scroll", updateTooltipPosition);
    }

    // Also listen for window resize
    window.addEventListener("resize", updateTooltipPosition);

    return () => {
      if (scrollArea) {
        scrollArea.removeEventListener("scroll", updateTooltipPosition);
      }

      if (scrollViewport) {
        scrollViewport.removeEventListener("scroll", updateTooltipPosition);
      }

      window.removeEventListener("resize", updateTooltipPosition);
    };
  });

  // Function to update tooltip position
  function updateTooltipPosition() {
    if (activeTooltip && activeButton) {
      const rect = activeButton.getBoundingClientRect();
      activeTooltip.style.left = `${rect.right + 8}px`;
      activeTooltip.style.top = `${rect.top + rect.height / 2}px`;
    }
  }

  $effect(() => {
    if (user.session) isLoginDialogOpen = false;
  });

  async function createSpace() {
    if (!newSpaceName || !user.agent || !g.roomy) return;
    const space = await g.roomy.create(Space);
    space.name = newSpaceName;
    space.admins((admins) => admins.push(user.agent!.assertDid));
    space.commit();

    g.roomy.spaces.push(space);
    g.roomy.commit();
    newSpaceName = "";

    isNewSpaceDialogOpen = false;
  }

  let loginError = $state("");
  async function login() {
    loginLoading = true;

    try {
      handleInput = cleanHandle(handleInput);
      await user.loginWithHandle(handleInput);
    } catch (e: unknown) {
      console.error(e);
      loginError = e instanceof Error ? e.message : String(e);
    }

    loginLoading = false;
  }
</script>

<svelte:head>
  <title>Roomy</title>
</svelte:head>

{#if dev}
  <RenderScan />
{/if}

<!-- Container -->
<div class="flex w-screen h-screen bg-base-100">
  <Toaster />
  <!-- Server Bar -->

  <aside
    class="w-fit col-span-2 flex flex-col px-4 py-8 items-center border-r-2 border-base-200 h-full"
  >
    <div
      class="flex flex-col h-full w-full flex-grow overflow-hidden sidebar-content"
    >
      <div class="flex justify-end w-full mb-2">
        <Button.Root
          class="btn btn-ghost btn-sm"
          onclick={refreshSpaces}
          title="Refresh spaces list"
        >
          <Icon icon="basil:refresh-solid" />
        </Button.Root>
      </div>
      <ToggleGroup.Root
        type="single"
        value={g.currentCatalog}
        class="flex flex-col gap-2 items-center w-full pl-2"
      >
        <ToggleGroup.Item
          value="home"
          onclick={() => navigate("home")}
          class="btn btn-ghost size-16 data-[state=on]:border-accent mb-2"
        >
          <Icon icon="basil:home-solid" font-size="2em" />
        </ToggleGroup.Item>

        <ScrollArea.Root class="space-list-scroll flex-grow h-full">
          <ScrollArea.Viewport class="h-full w-full">
            <div class="flex flex-col gap-2 items-center">
              {#each spaces.value as space}
                <ContextMenu
                  menuTitle={space.name}
                  items={[
                    {
                      label: "Settings",
                      icon: "basil:settings-solid",
                      onselect: () => {},
                    },
                    {
                      label: "Leave",
                      icon: "basil:sign-out-solid",
                      onselect: () => {},
                    },
                  ]}
                >
                  <ToggleGroup.Item
                    onclick={() =>
                      navigate({
                        space:
                          typeof space.handles === "function"
                            ? space.handles((h) => h.get(0)) || space.id
                            : space.id,
                      })}
                    value={space.id}
                    class="btn btn-ghost size-16 data-[state=on]:border-primary relative group"
                  >
                    <Avatar.Root>
                      <Avatar.Image />
                      <Avatar.Fallback>
                        <AvatarMarble name={space.id} />
                      </Avatar.Fallback>
                    </Avatar.Root>

                    <!-- Fast tooltip with no delay -->
                    <div
                      class="absolute left-full ml-2 px-2 py-1 bg-base-300 rounded shadow-md text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50"
                    >
                      {space.name}
                    </div>
                  </ToggleGroup.Item>
                </ContextMenu>
              {/each}
            </div>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar
            orientation="vertical"
            class="flex h-full w-2.5 touch-none select-none rounded-full border-l border-l-transparent p-px transition-all hover:w-3 hover:bg-dark-10 mr-1"
          >
            <ScrollArea.Thumb
              class="relative flex-1 rounded-full bg-base-300 transition-opacity"
            />
          </ScrollArea.Scrollbar>
          <ScrollArea.Corner />
        </ScrollArea.Root>
      </ToggleGroup.Root>

      <section class="menu gap-3">
        <ThemeSelector />
        <Dialog
          title="Create Space"
          description="Create a new public chat space"
          bind:isDialogOpen={isNewSpaceDialogOpen}
        >
          {#snippet dialogTrigger()}
            <Button.Root title="Create Space" class="btn btn-ghost w-fit">
              <Icon icon="basil:add-solid" font-size="2em" />
            </Button.Root>
          {/snippet}

          <form class="flex flex-col gap-4" onsubmit={createSpace}>
            <input
              bind:value={newSpaceName}
              placeholder="Name"
              class="input w-full"
            />
            <Button.Root disabled={!newSpaceName} class="btn btn-primary">
              <Icon icon="basil:add-outline" font-size="1.8em" />
              Create Space
            </Button.Root>
          </form>
        </Dialog>

        <Dialog
          title={user.session
            ? `Logged In As ${user.profile.data?.handle}`
            : "Login with AT Protocol"}
          bind:isDialogOpen={isLoginDialogOpen}
        >
          {#snippet dialogTrigger()}
            <Button.Root class="btn btn-ghost w-fit">
              <AvatarImage
                handle={user.profile.data?.handle || ""}
                avatarUrl={user.profile.data?.avatar}
              />
            </Button.Root>
          {/snippet}

          {#if user.session}
            <section class="flex flex-col gap-4">
              <Button.Root onclick={user.logout} class="btn btn-error">
                Logout
              </Button.Root>
            </section>
          {:else}
            <form class="flex flex-col gap-4" onsubmit={login}>
              {#if loginError}
                <p class="text-error">{loginError}</p>
              {/if}
              <input
                bind:value={handleInput}
                placeholder="Handle (eg alice.bsky.social)"
                class="input w-full"
              />
              <Button.Root
                disabled={loginLoading || !handleInput}
                class="btn btn-primary"
              >
                {#if loginLoading}
                  <span class="loading loading-spinner"></span>
                {/if}
                Login with Bluesky
              </Button.Root>
            </form>
          {/if}
        </Dialog>
      </section>
    </div>
  </aside>

  {@render children()}
</div>

<style>
  /* Using :global to prevent Svelte from warning about unused selectors */
  :global(.space-tooltip-visible) {
    opacity: 1 !important;
    visibility: visible !important;
  }
</style>
