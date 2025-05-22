<script lang="ts">
  import { globalState } from "$lib/global.svelte";
  import { user } from "$lib/user.svelte";
  import { navigate } from "$lib/utils.svelte";
  import { Button } from "bits-ui";
  import Icon from "@iconify/svelte";
  import Dialog from "$lib/components/Dialog.svelte";
  import AvatarImage from "$lib/components/AvatarImage.svelte";
  import ThemeSelector from "$lib/components/ThemeSelector.svelte";
  import SidebarSpace from "$lib/components/SidebarSpace.svelte";
  import { Space, type EntityList, type EntityWrapper, type TimelineItem } from "@roomy-chat/sdk";
  import { cleanHandle } from "$lib/utils.svelte";
  import { atproto } from "$lib/atproto.svelte";
  import { focusOnRender } from "$lib/actions/useFocusOnRender.svelte";
  import { env } from "$env/dynamic/public";
  import JSZip from "jszip";
  import FileSaver from "file-saver";

  // Props
  let { spaces, visible } = $props() as { 
    spaces: { value: Space[] }; 
    visible: boolean;
  };

  // State
  let handleInput = $state("");
  let loginLoading = $state(false);
  let signupLoading = $state(false);
  let loginError = $state("");
  let newSpaceName = $state("");
  let isNewSpaceDialogOpen = $state(false);
  let showEntityDownloader = $state(false);
  let entityIdInput = $state('');
  let downloadStatus = $state('');
  let isDownloading = $state(false);

  // Derived state
  const loadingAuth = $derived(signupLoading || loginLoading);

  // Type definitions
  interface EntityWithDoc {
    entity: {
      id: { toString(): string };
      doc: { 
        export: (options: { 
          mode: "snapshot" 
        } | { 
          mode: "updates-in-range"; 
          spans: { id: { toString(): string }; len: number }[] 
        }) => Uint8Array;
      };
    };
  }

  interface EntityWithTimeline extends EntityWrapper {
    timeline: EntityList<TimelineItem>;
  }

  // Functions
  async function createSpace() {
    if (!newSpaceName || !user.agent || !globalState.roomy) return;
    const space = await globalState.roomy.create(Space);
    space.name = newSpaceName;
    space.admins((x) => user.agent && x.push(user.agent.assertDid));
    space.commit();

    globalState.roomy.spaces.push(space);
    globalState.roomy.commit();
    newSpaceName = "";
    isNewSpaceDialogOpen = false;
  }

  async function login() {
    loginLoading = true;
    loginError = "";

    try {
      handleInput = cleanHandle(handleInput);
      await user.loginWithHandle(handleInput);
    } catch (e: unknown) {
      console.error(e);
      loginError = e instanceof Error ? e.message.toString() : "Unknown error";
    } finally {
      loginLoading = false;
    }
  }

  async function signup() {
    signupLoading = true;
    loginError = "";
    
    try {
      await atproto.oauth.signIn("https://bsky.social");
    } catch (e: unknown) {
      console.error(e);
      loginError = e instanceof Error ? e.message.toString() : "Unknown error";
    } finally {
      signupLoading = false;
    }
  }

  async function addEntityToZip(
    zip: JSZip, 
    entity: EntityWithDoc & Partial<EntityWithTimeline>,
    timeoutMs = 5000, // 5 second default timeout
    context: string[] = [] // Track parent context
  ) {
    const id = entity.entity.id.toString();
    const doc = entity.entity.doc;

    if (id in zip.files) return;

    // Add current entity to context
    const currentContext = [...context, id];
    const contextString = currentContext.join(' > ');
    
    // Define a type for the export method that can handle both signatures
    type ExportFunction = {
      (options: { mode: "snapshot" } | { mode: "updates-in-range"; spans: Array<{ id: { toString(): string }; len: number }> }): Uint8Array;
      (mode: string): Uint8Array;
    };

    const exportFn = doc.export as ExportFunction;
    
    let exported: Uint8Array | null = null;
    let timedOut = false;
    
    // Create a promise that will reject after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error(`Export timed out after ${timeoutMs}ms for entity ${id}`));
      }, timeoutMs);
    });
    
    // Create the export promise
    const exportPromise = (async () => {
      try {
        // Try the new signature first
        return exportFn({ mode: "snapshot" });
      } catch (e) {
        // Fall back to the old signature if the new one fails
        return exportFn("snapshot");
      }
    })();
    
    try {
      // Race the export against the timeout
      exported = await Promise.race([exportPromise, timeoutPromise]);
    } catch (e) {
      console.error(`Error exporting entity (${contextString}):`, e);
      if (timedOut) {
        console.warn(`Skipping entity (${contextString}) due to timeout`);
        return; // Skip this entity if it times out
      }
      throw e; // Re-throw other errors
    }
    
    if (exported) {
      zip.file(id, exported);
    }

    if ("timeline" in entity && entity.timeline) {
      await addEntityListToZip(zip, entity.timeline, timeoutMs, currentContext);
    }
  }

  async function addEntityListToZip<T extends EntityWrapper>(
    zip: JSZip, 
    entityList: EntityList<T>,
    timeoutMs = 30000, // 30s default timeout for the entire list
    context: string[] = [] // Parent context
  ) {
    const listId = entityList.id ? entityList.id.toString() : 'unknown';
    const currentContext = [...context];
    const startTime = Date.now();
    
    if (currentContext[currentContext.length - 1] !== listId) {
      currentContext.push(listId);
    }
    
    console.log(`[${new Date().toISOString()}] Processing entity list (${listId}) with context:`, currentContext);
    
    // First get all IDs synchronously
    let entityIds: string[] = [];
    try {
      const idStart = Date.now();
      entityIds = entityList.ids();
      console.log(`[${new Date().toISOString()}] Found ${entityIds.length} items to process in ${Date.now() - idStart}ms`);
      if (entityIds.length === 0) {
        console.log(`[${new Date().toISOString()}] No items to process, returning early`);
        return;
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Error getting IDs for list ${listId}:`, e);
      return;
    }

    // Process items in smaller batches with individual timeouts
    const BATCH_SIZE = 3; // Reduced batch size to reduce parallel load
    const ITEM_TIMEOUT_MS = 15000; // Increased to 15s per item
    const failedItems: string[] = [];
    
    for (let i = 0; i < entityIds.length; i += BATCH_SIZE) {
      const batchIds = entityIds.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i/BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(entityIds.length/BATCH_SIZE);
      
      console.log(`[${new Date().toISOString()}] Processing batch ${batchNum}/${totalBatches} with ${batchIds.length} items`);
      
      await Promise.all(batchIds.map(async (entityId, indexInBatch) => {
        const itemContext = [...currentContext, entityId];
        const itemNumber = i + indexInBatch + 1;
        const itemStart = Date.now();
        
        try {
          await Promise.race([
            (async () => {
              console.log(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Starting processing of item ${entityId}`);
              
              try {
                // Step 1: Open the entity
                console.log(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Opening entity...`);
                const openStart = Date.now();
                const item = await entityList.peer.open(entityId);
                console.log(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Entity opened in ${Date.now() - openStart}ms`);
                
                if (!item) {
                  throw new Error(`Failed to open entity ${entityId}`);
                }
                
                // Step 2: Create wrapper
                console.log(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Creating wrapper...`);
                const wrapperStart = Date.now();
                const wrapped = new (entityList as any).constructor(entityList.peer, item);
                console.log(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Wrapper created in ${Date.now() - wrapperStart}ms`);
                
                // Step 3: Export the document
                console.log(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Exporting document...`);
                const exportStart = Date.now();
                const doc = wrapped.entity.doc as { export: (opts: { mode: string }) => Uint8Array };
                const exported = doc.export({ mode: "snapshot" });
                console.log(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Document exported in ${Date.now() - exportStart}ms`);
                
                // Step 4: Add to zip
                zip.file(entityId, exported);
                
                const totalTime = Date.now() - itemStart;
                console.log(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Successfully processed item in ${totalTime}ms`);
                
                // Process any nested entities
                if ("timeline" in wrapped) {
                  console.log(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Processing nested timeline...`);
                  const timelineStart = Date.now();
                  await addEntityListToZip(zip, wrapped.timeline, timeoutMs, [...itemContext, 'timeline']);
                  console.log(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Nested timeline processed in ${Date.now() - timelineStart}ms`);
                }
              } catch (e) {
                console.error(`[${new Date().toISOString()}] [${itemNumber}/${entityIds.length}] Error in processing pipeline:`, e);
                throw e; // Re-throw to be caught by the outer catch
              }
            })(),
            new Promise((_, reject) => 
              setTimeout(
                () => reject(new Error(`Item ${itemNumber}/${entityIds.length} (${entityId}) timed out after ${ITEM_TIMEOUT_MS}ms`)), 
                ITEM_TIMEOUT_MS
              )
            )
          ]);
        } catch (e) {
          console.error(`[${new Date().toISOString()}] Error in batch processing item ${itemNumber}/${entityIds.length} (${entityId}):`, e);
          failedItems.push(entityId);
          // Continue with next item even if one fails
        }
      }));
      
      // Add a small delay between batches to prevent overwhelming the system
      if (i + BATCH_SIZE < entityIds.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] Finished processing list ${listId} (${entityIds.length} items, ${failedItems.length} failed) in ${totalTime}ms`);
    if (failedItems.length > 0) {
      console.warn(`[${new Date().toISOString()}] Failed items:`, failedItems);
    }
  }

  async function exportZip() {
    interface ExportMetadata {
      Type: string;
      Version: string;
      space_id: string;
      [key: string]: string | number | boolean | null | undefined;
    }

    const metadata: ExportMetadata = {
      Type: "RoomyData",
      Version: "0",
      space_id: ""
    };

    const zip = new JSZip();
    const space = globalState.space;
    if (!space) return;

    metadata.space_id = space.entity.id.toString();
    
    try {
      await Promise.all([
        addEntityToZip(zip, space, 50000, [space.entity.id.toString()]),
        addEntityListToZip(zip, space.threads, 5000, [space.entity.id.toString(), 'threads']),
        addEntityListToZip(zip, space.channels, 5000, [space.entity.id.toString(), 'channels']),
        addEntityListToZip(zip, space.wikipages, 5000, [space.entity.id.toString(), 'wikipages'])
      ]);

      zip.file("meta.json", JSON.stringify(metadata));
      const content = await zip.generateAsync({ type: "blob" });
      FileSaver.saveAs(content, "roomy-data.zip");
    } catch (error) {
      console.error("Error creating zip:", error);
    }
  }

  async function downloadEntity() {
    if (!entityIdInput.trim()) {
      downloadStatus = 'Error: Please enter an entity ID';
      return;
    }
    
    if (!globalState.roomy?.peer) {
      downloadStatus = 'Error: Not connected to server';
      return;
    }
    
    const entityId = entityIdInput.trim();
    isDownloading = true;
    downloadStatus = 'Downloading...';
    
    try {
      // Get the entity
      const entity = await globalState.roomy.peer.open(entityId);
      if (!entity) {
        throw new Error('Entity not found');
      }
      
      // Convert entity to a plain object
      const entityData = {
        id: entity.id,
        type: entity.type,
        doc: entity.doc ? JSON.parse(JSON.stringify(entity.doc)) : null,
        // Add any other relevant properties
      };
      
      // Create JSON string
      const jsonStr = JSON.stringify(entityData, null, 2);
      
      // Create and trigger download
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `entity-${entityId}.json`;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      
      downloadStatus = 'Download complete!';
      
    } catch (e) {
      console.error('Download failed:', e);
      downloadStatus = `Error: ${e instanceof Error ? e.message : 'Failed to download entity'}`;
    } finally {
      isDownloading = false;
    }
  }
</script>

<!-- Width manually set for transition to w-0 -->
<aside
  class="flex flex-col justify-between align-center h-full {visible
    ? 'w-[60px] px-1 border-r-2'
    : 'w-[0]'} py-2 border-base-200 bg-base-300 transition-[width] duration-100 ease-out"
  class:opacity-0={!visible}
>
  <div class="flex flex-col gap-1 items-center">
    <button
      type="button"
      onclick={() => navigate("home")}
      class="dz-btn dz-btn-ghost px-1 w-full aspect-square"
    >
      <Icon icon="iconamoon:home-fill" font-size="1.75em" />
    </button>

    {#if user.session}
      <Dialog
        title="Create Space"
        description="Create a new public chat space"
        bind:isDialogOpen={isNewSpaceDialogOpen}
      >
        {#snippet dialogTrigger()}
          <Button.Root
            title="Create Space"
            class="p-2 aspect-square rounded-lg hover:bg-base-200 cursor-pointer"
          >
            <Icon icon="basil:add-solid" font-size="2em" />
          </Button.Root>
        {/snippet}

        <form
          id="createSpace"
          class="flex flex-col gap-4"
          onsubmit={createSpace}
        >
          <input
            bind:value={newSpaceName}
            use:focusOnRender
            placeholder="Name"
            class="dz-input w-full"
            type="text"
            required
          />
          <Button.Root disabled={!newSpaceName} class="dz-btn dz-btn-primary">
            <Icon icon="basil:add-outline" font-size="1.8em" />
            Create Space
          </Button.Root>
        </form>
      </Dialog>
    {/if}

    <div class="divider my-0"></div>

    {#each spaces.value as space, i}
      <SidebarSpace {space} {i} />
    {/each}
  </div>

  <section class="flex flex-col items-center gap-2 p-0">
    <!-- Only expose Discord import in dev with a flag for now. -->
    {#if env.PUBLIC_ENABLE_DISCORD_IMPORT == "true"}
      <Button.Root
        title="Import Discord Archive"
        class="p-2 aspect-square rounded-lg hover:bg-base-200 cursor-pointer"
        disabled={!user.session}
        href="/discord-import"
      >
        <Icon icon="mdi:folder-upload-outline" font-size="1.8em" />
      </Button.Root>
    {/if}

    <Button.Root
      title="Export ZIP Archive"
      class="p-2 aspect-square rounded-lg hover:bg-base-200 cursor-pointer"
      disabled={!user.session}
      onclick={exportZip}
    >
      <Icon icon="mdi:folder-download-outline" font-size="1.8em" />
    </Button.Root>

    <Button.Root
      title="Download Entity"
      class="p-2 aspect-square rounded-lg hover:bg-base-200 cursor-pointer"
      disabled={!user.session}
      onclick={() => showEntityDownloader = true}
    >
      <Icon icon="mdi:download" font-size="1.8em" />
    </Button.Root>

    <ThemeSelector />
    <Dialog
      title={user.session ? "Log Out" : "Create Account or Log In"}
      description={user.session
        ? `Logged in as ${user.profile.data?.handle}`
        : `We use the AT Protocol to authenticate users <a href="https://atproto.com/guides/identity" class="text-primary hover:text-primary/75"> learn more </a>`}
      bind:isDialogOpen={user.isLoginDialogOpen}
    >
      {#snippet dialogTrigger()}
        <AvatarImage
          className="p-1 w-full cursor-pointer"
          handle={user.profile.data?.handle || ""}
          avatarUrl={user.profile.data?.avatar}
        />
      {/snippet}

      {#if user.session}
        <section class="flex flex-col gap-4">
          <Button.Root onclick={user.logout} class="dz-btn dz-btn-error">
            Log Out
          </Button.Root>
        </section>
      {:else}
        <Button.Root
          onclick={signup}
          disabled={loadingAuth}
          class="dz-btn dz-btn-primary"
        >
          {#if signupLoading}
            <span class="dz-loading dz-loading-spinner"></span>
          {/if}
          <Icon
            icon="simple-icons:bluesky"
            width="16"
            height="16"
          />Authenticate with Bluesky
        </Button.Root>
        <p class="text-sm pt-4">Know your handle? Log in with it below.</p>
        <form class="flex flex-col gap-4" onsubmit={login}>
          {#if loginError}
            <p class="text-error">{loginError}</p>
          {/if}
          <input
            bind:value={handleInput}
            placeholder="Handle (eg alice.bsky.social)"
            class="dz-input w-full"
            type="text"
            required
          />
          <Button.Root
            disabled={loadingAuth || !handleInput}
            class="dz-btn dz-btn-primary"
          >
            {#if loginLoading}
              <span class="dz-loading dz-loading-spinner"></span>
            {/if}
            Log in with bsky.social
          </Button.Root>
        </form>

        <p class="text-sm text-center pt-4 text-base-content/50">
          More options coming soon!
        </p>
      {/if}
    </Dialog>
  </section>
</aside>

{#if showEntityDownloader}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
    <div class="bg-base-100 p-6 rounded-lg shadow-xl w-full max-w-md">
      <h3 class="text-lg font-bold mb-4">Download Entity</h3>
      
      <div class="form-control w-full mb-4">
        <label class="label">
          <span class="label-text">Entity ID</span>
        </label>
        <input 
          type="text" 
          bind:value={entityIdInput}
          placeholder="Enter entity ID (e.g., leaf:...)" 
          class="input input-bordered w-full"
          onkeydown={(e) => e.key === 'Enter' && downloadEntity()}
        />
      </div>
      
      {#if downloadStatus}
        <div class="mb-4 text-sm text-{downloadStatus.startsWith('Error') ? 'error' : 'success'}">
          {downloadStatus}
        </div>
      {/if}
      
      <div class="flex justify-end gap-2">
        <button 
          onclick={() => {
            showEntityDownloader = false;
            entityIdInput = '';
            downloadStatus = '';
          }} 
          class="btn btn-ghost"
          disabled={isDownloading}
        >
          Cancel
        </button>
        <button 
          onclick={downloadEntity} 
          class="btn btn-primary"
          disabled={!entityIdInput.trim() || isDownloading}
        >
          {isDownloading ? 'Downloading...' : 'Download'}
        </button>
      </div>
    </div>
  </div>
{/if}
