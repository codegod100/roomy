<script lang="ts">
  import type { Autodoc } from "$lib/autodoc/peer";
  import ChatArea from "$lib/components/ChatArea.svelte";
  import { g } from "$lib/global.svelte";
  import Dialog from "$lib/components/Dialog.svelte";
  import type {
    Did,
    Space,
    SpaceChannel,
    Thread,
    Ulid,
  } from "$lib/schemas/types";
  import { page } from "$app/state";
  import { user } from "$lib/user.svelte";
  import { setContext } from "svelte";
  import { Avatar, Button, Popover, ScrollArea, Tabs, Toggle } from "bits-ui";
  import { AvatarBeam } from "svelte-boring-avatars";
  import Icon from "@iconify/svelte";
  import { fly } from "svelte/transition";
  import { ulid } from "ulidx";
  import ThreadRow from "$lib/components/ThreadRow.svelte";
  import { goto } from "$app/navigation";
  import ChatMessage from "$lib/components/ChatMessage.svelte";
  import toast from "svelte-french-toast";
  import _ from "underscore";
  import { renderMarkdownSanitized } from "$lib/markdown";
  import { outerWidth } from "svelte/reactivity/window";
  import AvatarImage from "$lib/components/AvatarImage.svelte";
  import VideoChat from "$lib/components/VideoChat.svelte";
  import { createEventDispatcher } from "svelte";

  let isMobile = $derived((outerWidth.current ?? 0) < 640);

  // State for video chat
  let showVideoChat = $state(false);
  let videoLayout = $state<"sidebar" | "fullscreen">("sidebar");
  let participantStreams = $state<Map<string, MediaStream>>(new Map());

  // Track active speakers
  let activeSpeakers = $state<Set<string>>(new Set());

  // Function to handle new participant joining video
  function handleParticipantJoin(
    event: CustomEvent<{ did: string; stream: MediaStream }>,
  ) {
    const { did, stream } = event.detail;
    participantStreams.set(did, stream);
  }

  // Function to handle participant leaving
  function handleParticipantLeave(event: CustomEvent<{ did: string }>) {
    const { did } = event.detail;
    participantStreams.delete(did);
    activeSpeakers.delete(did);
  }

  // Function to toggle video chat layout
  function toggleVideoLayout() {
    videoLayout = videoLayout === "sidebar" ? "fullscreen" : "sidebar";
  }

  let tab = $state("chat");
  let space: Autodoc<Space> | undefined = $derived(g.spaces[page.params.space]);
  let channel = $derived(space.view.channels[page.params.channel]) as
    | SpaceChannel
    | undefined;
  let messageInput = $state("");
  let currentThread = $derived.by(() => {
    if (page.url.searchParams.has("thread")) {
      return space.view.threads[page.url.searchParams.get("thread")!] as Thread;
    } else {
      return null;
    }
  });
  let imageFiles: FileList | null = $state(null);

  $effect(() => {
    if (currentThread) {
      tab = "threads";
    }
  });

  // thread maker
  let isThreading = $state({ value: false });
  let threadTitleInput = $state("");
  let selectedMessages: Ulid[] = $state([]);
  setContext("isThreading", isThreading);
  setContext("selectMessage", (message: Ulid) => {
    selectedMessages.push(message);
  });
  setContext("removeSelectedMessage", (message: Ulid) => {
    selectedMessages = selectedMessages.filter((m) => m != message);
  });
  setContext("deleteMessage", (message: Ulid) => {
    space.change((doc) => {
      // TODO: don't remove from timeline, just delete ID? We need to eventually add a marker
      // showing the messages is deleted in the timeline.
      Object.values(doc.channels).forEach((x) => {
        const idx = x.timeline.indexOf(message);
        if (idx !== -1) x.timeline.splice(idx, 1);
      });
      Object.values(doc.threads).forEach((x) => {
        const idx = x.timeline.indexOf(message);
        if (idx !== -1) x.timeline.splice(idx, 1);
      });
      delete doc.messages[message];
    });
  });

  $effect(() => {
    if (!isThreading.value && selectedMessages.length > 0) {
      selectedMessages = [];
    }
  });

  // Reply Utils
  let replyingTo = $state<{
    id: Ulid;
    authorProfile: { handle: string; avatarUrl: string };
    content: string;
  } | null>();

  setContext(
    "setReplyTo",
    (value: {
      id: Ulid;
      profile: { handle: string; avatarUrl: string };
      content: string;
    }) => {
      replyingTo = {
        id: value.id,
        authorProfile: value.profile,
        content: value.content
      };
    },
  );

  setContext("toggleReaction", (id: Ulid, reaction: string) => {
    if (!space) return;

    space.change((doc) => {
      const did = user.profile.data?.did;
      if (!did) return;

      let reactions = doc.messages[id].reactions[reaction] ?? [];

      if (reactions.includes(did)) {
        if (doc.messages[id].reactions[reaction].length - 1 === 0) {
          delete doc.messages[id].reactions[reaction];
        } else {
          doc.messages[id].reactions[reaction] = reactions.filter(
            (actor: Did) => actor !== did,
          );
        }
      } else {
        if (!doc.messages[id].reactions) {
          // init reactions object
          doc.messages[id].reactions = {};
        }
        doc.messages[id].reactions[reaction] = [...reactions, did];
      }
    });
  });

  function createThread(e: SubmitEvent) {
    e.preventDefault();
    if (!space) return;

    space.change((doc) => {
      const id = ulid();
      const timeline = [];
      for (const id of selectedMessages) {
        timeline.push(`${id}`);
      }
      doc.threads[id] = {
        title: threadTitleInput,
        timeline,
      };
    });

    threadTitleInput = "";
    isThreading.value = false;
    toast.success("Thread created", { position: "bottom-end" });
  }

  async function sendMessage(e: SubmitEvent) {
    e.preventDefault();
    if (!space) return;

    const images = imageFiles
      ? await Promise.all(
          Array.from(imageFiles).map(async (file) => {
            try {
              const resp = await user.uploadBlob(file);
              return {
                source: resp.url, // Use the blob reference from ATP
                alt: file.name,
              };
            } catch (error) {
              console.error("Failed to upload image:", error);
              toast.error("Failed to upload image", { position: "bottom-end" });
              return null;
            }
          }),
        ).then((results) =>
          results.filter(
            (result): result is NonNullable<typeof result> => result !== null,
          ),
        )
      : undefined;
    space.change((doc) => {
      if (!user.agent) return;

      const id = ulid();
      doc.messages[id] = {
        author: user.agent.assertDid,
        reactions: {},
        content: messageInput,
        ...(replyingTo && { replyTo: replyingTo.id }),
        ...(images && { images }),
      };
      doc.channels[page.params.channel].timeline.push(id);
    });

    messageInput = "";
    replyingTo = null;
    imageFiles = null;
  }

  function deleteThread(id: Ulid) {
    if (!space) return;

    space.change((doc) => {
      delete doc.threads[id];
    });

    toast.success("Thread deleted", { position: "bottom-end" });
    goto(page.url.pathname);
  }

  //
  // Settings Dialog
  //

  let isAdmin = $derived(
    user.agent && space && space.view.admins.includes(user.agent.assertDid),
  );
  let mayUploadImages = $derived.by(() => {
    if (isAdmin) return true;

    let messagesByUser = Object.values(space.view.messages).filter(
      (x) => user.agent && x.author == user.agent.assertDid,
    );
    if (messagesByUser.length > 5) return true;
    return !!messagesByUser.find(
      (message) =>
        !!Object.values(message.reactions).find(
          (reactedUsers) =>
            !!reactedUsers.find((user) => !!space.view.admins.includes(user)),
        ),
    );
  });
  let showSettingsDialog = $state(false);
  let channelNameInput = $state("");
  let channelCategoryInput = $state(undefined) as undefined | string;
  $effect(() => {
    channelNameInput = channel?.name || "";
    channelCategoryInput = Object.entries(space.view.categories).find(
      ([_id, category]) => category.channels.includes(page.params.channel),
    )?.[0];
  });

  function saveSettings() {
    space?.change((space) => {
      if (channelNameInput) {
        space.channels[page.params.channel].name = channelNameInput;
      }
      Object.entries(space.categories).forEach(([catId, category]) => {
        if (channelCategoryInput !== catId) {
          const idx = category.channels.indexOf(page.params.channel);
          if (idx !== -1) {
            category.channels.splice(idx, 1);
          }
        }
        if (channelCategoryInput) {
          const category = space.categories[channelCategoryInput];
          if (!category.channels.includes(page.params.channel)) {
            category.channels.push(page.params.channel);
          }
          const idx = space.sidebarItems.findIndex(
            (x) => x.type == "channel" && x.id == page.params.channel,
          );
          if (idx !== -1) {
            space.sidebarItems.splice(idx, 1);
          }
        } else if (
          !space.sidebarItems.find(
            (x) => x.type == "channel" && x.id == page.params.channel,
          )
        ) {
          space.sidebarItems.push({ type: "channel", id: page.params.channel });
        }
      });
    });
    showSettingsDialog = false;
  }

  async function handleImageSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    imageFiles = input.files;
  }

  async function handlePaste(event: ClipboardEvent) {
    if (!mayUploadImages) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          imageFiles = new DataTransfer().files;
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          imageFiles = dataTransfer.files;
        }
      }
    }
  }

  let videoRef: VideoChat | undefined = $state();
  let connectedPeers = $state<Set<string>>(new Set());

  // Function to handle signaling message
  function sendSignalingMessage(targetPeerId: string, message: any) {
    if (!user.agent) return;
    
    // Send message directly to peer through your preferred transport
    // This could be WebSocket, REST API, etc.
    console.log('Sending signal to peer:', targetPeerId, message);
    
    // For now, we'll simulate the message delivery locally
    // In production, replace this with actual message delivery
    if (videoRef) {
      videoRef.handleSignalingMessage(targetPeerId, message);
    }
  }

  // Update UI when peers connect/disconnect
  function handlePeerConnect(event: CustomEvent<{ did: string }>) {
    const { did } = event.detail;
    connectedPeers.add(did);
  }

  function handlePeerDisconnect(event: CustomEvent<{ did: string }>) {
    const { did } = event.detail;
    connectedPeers.delete(did);
  }
</script>

<header class="flex flex-none items-center justify-between border-b-1 pb-4">
  <div class="flex gap-4 items-center">
    {#if isMobile}
      <Button.Root onclick={() => goto(`/space/${page.params.space}`)}>
        <Icon icon="uil:left" color="white" />
      </Button.Root>
    {:else}
      <AvatarImage avatarUrl={channel?.avatar} handle={channel?.name ?? ""} />
    {/if}

    <span class="flex gap-2 items-center">
      {#if !isMobile || (isMobile && !currentThread)}
        <h4
          class={`${isMobile && "line-clamp-1 overflow-hidden text-ellipsis"} text-white text-lg font-bold`}
        >
          {channel?.name}
        </h4>
      {/if}

      {#if currentThread}
        {#if !isMobile}
          <Icon icon="mingcute:right-line" color="white" />
        {/if}
        <Icon icon="lucide-lab:reel-thread" color="white" />
        <h5 class="text-white text-lg font-bold line-clamp-1 text-ellipsis">
          {currentThread.title}
        </h5>
      {/if}
    </span>
  </div>

  <Tabs.Root bind:value={tab}>
    <Tabs.List class="grid grid-cols-2 gap-4 border text-white p-1 rounded">
      <Tabs.Trigger
        value="chat"
        onclick={() => goto(page.url.pathname)}
        class="flex gap-2 w-full justify-center transition-all duration-150 items-center px-4 py-1 data-[state=active]:bg-violet-800 rounded"
      >
        <Icon icon="tabler:message" color="white" class="text-2xl" />
        {#if !isMobile}
          <p>Chat</p>
        {/if}
      </Tabs.Trigger>
      <Tabs.Trigger
        value="threads"
        class="flex gap-2 w-full justify-center transition-all duration-150 items-center px-4 py-1 data-[state=active]:bg-violet-800 rounded"
      >
        <Icon
          icon="material-symbols:thread-unread-rounded"
          color="white"
          class="text-2xl"
        />
        {#if !isMobile}
          <p>Threads</p>
        {/if}
      </Tabs.Trigger>
    </Tabs.List>
  </Tabs.Root>

  {#if !isMobile}
    <div class="flex">
      {@render toolbar({ growButton: false })}
    </div>
  {/if}
</header>

{#if showVideoChat}
  <div class={`video-chat-container ${videoLayout}`}>
    <div class="absolute top-2 left-2 z-20 flex gap-2 items-center bg-black/50 px-3 py-1 rounded-full">
      <span class="text-white text-sm">Connected peers: {connectedPeers.size}</span>
      {#each [...connectedPeers] as peerId}
        <div class="w-2 h-2 rounded-full bg-green-500"></div>
      {/each}
    </div>
    <button 
      class="absolute top-2 right-2 z-20 p-2 bg-red-500 hover:bg-red-600 rounded-full transition-colors duration-150"
      onclick={() => {
        showVideoChat = false;
        connectedPeers.clear();
        videoRef?.stopLocalStream();
      }}
    >
      <Icon icon="zondicons:close-solid" color="white" />
    </button>
    <VideoChat 
      bind:this={videoRef}
      peerId={user.agent?.did ?? ''} 
      on:participantJoin={handleParticipantJoin}
      on:participantLeave={handleParticipantLeave}
      on:peerConnect={handlePeerConnect}
      on:peerDisconnect={handlePeerDisconnect}
      {sendSignalingMessage}
    />
  </div>
{/if}

{#if tab === "chat"}
  {@render chatTab()}
{:else if tab === "threads"}
  {@render threadsTab()}
{/if}

{#snippet chatTab()}
  {#if space}
    <ChatArea
      source={{ type: "space", space, channelId: page.params.channel }}
    />
    <div class="flex float-end">
      {#if !isMobile || !isThreading.value}
        <form onsubmit={sendMessage} class="grow flex flex-col">
          {#if replyingTo}
            <div
              class="flex justify-between bg-violet-800 text-white rounded-t-lg px-4 py-2"
            >
              <div class="flex flex-col gap-1">
                <h5 class="flex gap-2 items-center">
                  Replying to
                  <AvatarImage
                    handle={replyingTo.authorProfile.handle}
                    avatarUrl={replyingTo.authorProfile.avatarUrl}
                    className="!w-4"
                  />
                  <strong>{replyingTo.authorProfile.handle}</strong>
                </h5>
                <p class="text-gray-300 text-ellipsis italic">
                  {@html renderMarkdownSanitized(replyingTo.content)}
                </p>
              </div>
              <Button.Root
                type="button"
                onclick={() => (replyingTo = null)}
                class="cursor-pointer hover:scale-105 active:scale-95 transition-all duration-150"
              >
                <Icon icon="zondicons:close-solid" />
              </Button.Root>
            </div>
          {/if}
          <div class="relative">
            <input
              type="text"
              class={[
                replyingTo ? "rounded-b-lg" : "rounded-lg",
                "w-full px-4 py-2 flex-none text-white bg-violet-900",
              ]}
              placeholder="Say something..."
              bind:value={messageInput}
              onpaste={handlePaste}
            />
            {#if mayUploadImages}
              <label
                class="cursor-pointer text-white hover:text-gray-300 absolute right-3 top-1/2 -translate-y-1/2"
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  class="hidden"
                  onchange={handleImageSelect}
                />
                <Icon
                  icon="material-symbols:add-photo-alternate"
                  class="text-2xl"
                />
              </label>
            {/if}
          </div>
          <!-- Image preview -->
          {#if imageFiles?.length}
            <div class="flex gap-2 flex-wrap">
              {#each Array.from(imageFiles) as file}
                <div class="relative mt-5">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    class="w-20 h-20 object-cover rounded"
                  />
                  <button
                    type="button"
                    class="absolute -top-2 -right-2 bg-red-500 rounded-full p-1"
                    onclick={() => (imageFiles = null)}
                  >
                    <Icon icon="zondicons:close-solid" color="white" />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </form>
      {/if}

      {#if isMobile}
        {@render toolbar({ growButton: true })}
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet threadsTab()}
  {#if space}
    {#if currentThread}
      <section class="flex flex-col gap-4 items-start h-full">
        <menu class="px-4 py-2 flex w-full justify-between">
          <Button.Root
            onclick={() => goto(page.url.pathname)}
            class="flex gap-2 items-center text-white cursor-pointer hover:scale-105 transitiona-all duration-150"
          >
            <Icon icon="uil:left" />
            Back
          </Button.Root>
          <Dialog title="Delete Thread" bind:isDialogOpen={showSettingsDialog}>
            {#snippet dialogTrigger()}
              <Icon icon="tabler:trash" color="red" class="text-2xl" />
            {/snippet}
            <div class="flex flex-col items-center gap-4">
              <p>The thread will be unrecoverable once deleted.</p>
              <Button.Root
                onclick={() =>
                  deleteThread(page.url.searchParams.get("thread")!)}
                class="flex items-center gap-3 px-4 py-2 max-w-[20em] bg-red-600 text-white rounded-lg hover:scale-[102%] active:scale-95 transition-all duration-150"
              >
                Confirm Delete
              </Button.Root>
            </div>
          </Dialog>
        </menu>

        <ScrollArea.Root>
          <ScrollArea.Viewport class="max-w-screen h-full max-h-[90%]">
            <ScrollArea.Content>
              <ol class="flex flex-col gap-4">
                {#each currentThread.timeline as id}
                  {@const message = space.view.messages[id]}
                  <ChatMessage
                    {id}
                    {message}
                    messageRepliedTo={message.replyTo
                      ? space.view.messages[message.replyTo]
                      : undefined}
                  />
                {/each}
              </ol>
            </ScrollArea.Content>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar
            orientation="vertical"
            class="flex h-full w-2.5 touch-none select-none rounded-full border-l border-l-transparent p-px transition-all hover:w-3 hover:bg-dark-10"
          >
            <ScrollArea.Thumb
              class="relative flex-1 rounded-full bg-muted-foreground opacity-40 transition-opacity hover:opacity-100"
            />
          </ScrollArea.Scrollbar>
          <ScrollArea.Corner />
        </ScrollArea.Root>
      </section>
    {:else}
      <ul class="overflow-y-auto px-2 gap-3 flex flex-col">
        {#each Object.entries(space.view.threads) as [id, thread] (id)}
          <ThreadRow
            {id}
            {thread}
            onclick={() => goto(`?thread=${id}`)}
            onclickDelete={() => deleteThread(id)}
          />
        {/each}
      </ul>
    {/if}
  {/if}
{/snippet}

{#snippet toolbar({ growButton = false }: { growButton: boolean })}
  {#if isThreading.value}
    <div in:fly class={`${growButton && "grow w-full pr-2"}`}>
      <Popover.Root>
        <Popover.Trigger
          class={`cursor-pointer ${growButton ? "w-full" : "w-fit"} px-4 py-2 rounded bg-violet-800 text-white`}
        >
          Create Thread
        </Popover.Trigger>

        <Popover.Content
          transition={fly}
          sideOffset={8}
          class="bg-violet-800 p-4 rounded"
        >
          <form onsubmit={createThread} class="text-white flex flex-col gap-4">
            <label class="flex flex-col gap-1">
              Thread Title
              <input
                bind:value={threadTitleInput}
                type="text"
                placeholder="Notes"
                class="border px-4 py-2 rounded"
              />
            </label>
            <Popover.Close>
              <button
                type="submit"
                class="text-black px-4 py-2 bg-white rounded w-full text-center"
              >
                Confirm
              </button>
            </Popover.Close>
          </form>
        </Popover.Content>
      </Popover.Root>
    </div>
  {/if}
  <menu class="relative flex items-center gap-3 px-2 w-fit self-end">
    <Toggle.Root
      bind:pressed={isThreading.value}
      disabled={tab !== "chat"}
      class={`p-2 ${isThreading.value && "bg-white/10"} cursor-pointer hover:scale-105 active:scale-95 transition-all duration-150 rounded`}
    >
      <Icon
        icon="tabler:needle-thread"
        color={tab !== "chat" ? "gray" : "white"}
        class="text-2xl"
      />
    </Toggle.Root>
    <Button.Root
      title="Copy invite link"
      class="cursor-pointer hover:scale-105 active:scale-95 transition-all duration-150"
      onclick={() => {
        navigator.clipboard.writeText(`${page.url.href}`);
      }}
    >
      <Icon icon="icon-park-outline:copy-link" color="white" class="text-2xl" />
    </Button.Root>

    <Toggle.Root
      bind:pressed={showVideoChat}
      class={`p-2 ${showVideoChat && "bg-white/10"} cursor-pointer hover:scale-105 active:scale-95 transition-all duration-150 rounded`}
    >
      <Icon
        icon="tabler:video"
        color="white"
        class="text-2xl"
      />
    </Toggle.Root>

    {#if showVideoChat}
      <Button.Root
        title="Toggle video layout"
        class="cursor-pointer hover:scale-105 active:scale-95 transition-all duration-150"
        onclick={toggleVideoLayout}
      >
        <Icon 
          icon={videoLayout === "sidebar" ? "tabler:layout-sidebar" : "tabler:layout-grid"} 
          color="white" 
          class="text-2xl" 
        />
      </Button.Root>
    {/if}

    {#if isAdmin}
      <Dialog title="Channel Settings" bind:isDialogOpen={showSettingsDialog}>
        {#snippet dialogTrigger()}
          <Button.Root
            title="Channel Settings"
            class="cursor-pointer hover:scale-105 active:scale-95 transition-all duration-150 m-auto flex"
          >
            <Icon icon="lucide:settings" color="white" class="text-2xl" />
          </Button.Root>
        {/snippet}

        <form class="flex flex-col gap-4 w-full" onsubmit={saveSettings}>
          <label>
            Name
            <input
              bind:value={channelNameInput}
              placeholder="channel-name"
              class="w-full outline-hidden border border-white px-4 py-2 rounded-sm bg-transparent"
            />
          </label>
          {#if space}
            <select bind:value={channelCategoryInput}>
              <option class="bg-violet-900 text-white" value={undefined}
                >Category: None</option
              >
              {#each Object.keys(space.view.categories) as categoryId}
                {@const category = space.view.categories[categoryId]}
                <option class="bg-violet-900 text-white" value={categoryId}
                  >Category: {category.name}</option
                >
              {/each}
            </select>
          {/if}
          <Button.Root
            class={`px-4 py-2 bg-white text-black rounded-lg disabled:bg-white/50 active:scale-95 transition-all duration-150 flex items-center justify-center gap-2 hover:scale-[102%]`}
          >
            Save Settings
          </Button.Root>
        </form>
      </Dialog>
    {/if}
  </menu>
{/snippet}

<style>
  .video-chat-container {
    position: relative;
    z-index: 10;
    background: rgba(0, 0, 0, 0.85);
    border-radius: 0.75rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }

  .video-chat-container.sidebar {
    position: fixed;
    top: 1rem;
    right: 1rem;
    width: 320px;
    height: 240px;
    transition: all 0.3s ease;
  }

  .video-chat-container.sidebar:hover {
    transform: scale(1.02);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  }

  .video-chat-container.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 2rem;
  }

  .video-chat-container.fullscreen :global(video) {
    max-width: 90vw;
    max-height: 90vh;
    border-radius: 1rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .video-chat-container :global(.local-video) {
    position: absolute;
    bottom: 1rem;
    right: 1rem;
    width: 120px;
    height: 90px;
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 2;
  }

  .video-chat-container :global(.remote-video) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .video-chat-container button {
    opacity: 0.8;
    transition: all 0.2s ease;
    backdrop-filter: blur(4px);
  }

  .video-chat-container button:hover {
    opacity: 1;
    transform: scale(1.05);
  }

  .video-chat-container :global(.video-controls) {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.75rem;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    border-radius: 2rem;
    z-index: 3;
  }

  .video-chat-container :global(.video-controls button) {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .video-chat-container :global(.video-controls button:hover) {
    background: rgba(255, 255, 255, 0.2);
  }

  .video-chat-container :global(.video-controls button.disabled) {
    background: rgba(255, 0, 0, 0.2);
    border-color: rgba(255, 0, 0, 0.3);
  }
</style>
