<script lang="ts">
  // import type { Space } from "@roomy-chat/sdk";
import {Space,Image} from "$lib/schema"
  import ContextMenu from "./ContextMenu.svelte";
  import { AvatarMarble } from "svelte-boring-avatars";

  import { navigate } from "$lib/utils.svelte";
  import { derivePromise } from "$lib/utils.svelte";
  // import { Image } from "@roomy-chat/sdk";
  import TooltipPortal from "./TooltipPortal.svelte";
  import { globalState } from "$lib/global.svelte";
  import { page } from "$app/stores";

  type Props = {
    space: Space;
    i: number;
  };

  const { space, i }: Props = $props();

  // Tooltip state
  let activeTooltip = $state("");
  let tooltipPosition = $state({ x: 0, y: 0 });

  let isActive = $derived($page.url.pathname.includes(space.internal?.id || ''));

  const spaceImage = space.internal?.image
</script>

<TooltipPortal
  text={activeTooltip}
  visible={!!activeTooltip}
  x={tooltipPosition.x}
  y={tooltipPosition.y}
/>
<ContextMenu
  menuTitle={space.internal?.name}
  items={[
    {
      label: "Leave Space",
      icon: "mdi:exit-to-app",
      onselect: () => {
        // globalState.roomy?.spaces.remove(i);
        // globalState.roomy?.commit();
      },
    },
  ]}
>
  <button
    type="button"
    onclick={() =>
      navigate({ space: space.internal?.id || ""})}
    value={space.internal?.id}
    onmouseenter={(e: Event) => {
      activeTooltip = space.internal?.name || "";
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      tooltipPosition = { x: rect.right + 8, y: rect.top + rect.height / 2 };
    }}
    onmouseleave={() => {
      activeTooltip = "";
    }}
    onblur={() => {
      activeTooltip = "";
    }}
    class={`dz-btn dz-btn-ghost size-12 rounded-full relative group p-0.5
      ${isActive ? 'ring-0.5 ring-offset-0 ring-primary/30 border border-primary' : ''}
      transition-all duration-200`}
  >
    <div class="flex items-center justify-center overflow-hidden">
      {#if spaceImage?.uri}
        <img
          src={spaceImage?.uri}
          alt={space.internal?.name || ""}
          class="w-10 h-10 object-cover rounded-full object-center"
        />
      {:else if space.internal?.id}
        <div class="w-10 h-10">
          <AvatarMarble name={space.internal?.id} />
        </div>
      {:else}
        <div class="w-10 h-10 bg-base-300 rounded-full"></div>
      {/if}
    </div>
  </button>
</ContextMenu>
