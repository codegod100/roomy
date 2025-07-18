<script lang="ts" module>
  export const threading = $state({
    active: false,
    selectedMessages: [] as string[],
  });
</script>

<script lang="ts">
  import toast from "svelte-french-toast";
  import Icon from "@iconify/svelte";
  import ChatArea from "$lib/components/ChatArea.svelte";
  import ChatInput from "$lib/components/ChatInput.svelte";
  import { Button, Tabs } from "bits-ui";
  import { Account, co, Group } from "jazz-tools";
  import {
    LastReadList,
    Message,
    RoomyAccount,
    Thread,
  } from "$lib/jazz/schema";
  import TimelineToolbar from "$lib/components/TimelineToolbar.svelte";
  import CreatePageDialog from "$lib/components/CreatePageDialog.svelte";
  import BoardList from "./BoardList.svelte";
  import ToggleNavigation from "./ToggleNavigation.svelte";
  import { AccountCoState, CoState } from "jazz-svelte";
  import { Channel, Space } from "$lib/jazz/schema";
  import { page } from "$app/state";
  import {
    addToInbox,
    createMessage,
    createThread,
    isSpaceAdmin,
    type ImageUrlEmbedCreate,
  } from "$lib/jazz/utils";
  import { user } from "$lib/user.svelte";
  import { replyTo } from "./ChatMessage.svelte";
  import MessageRepliedTo from "./Message/MessageRepliedTo.svelte";
  import { extractLinks } from "$lib/utils/collectLinks";
  import FullscreenImageDropper from "./helper/FullscreenImageDropper.svelte";
  import UploadFileButton from "./helper/UploadFileButton.svelte";
  import { afterNavigate } from "$app/navigation";
  import SearchBar from "./search/SearchBar.svelte";

  let space = $derived(
    new CoState(Space, page.params.space, {
      resolve: {
        channels: {
          $each: true,
          $onError: null,
        },
        bans: {
          $each: true,
          $onError: null,
        },
        members: {
          $each: true,
          $onError: null,
        },
      },
    }),
  );

  const links = $derived(
    space.current?.threads?.find((x) => x?.name === "@links"),
  );

  let creator = $derived(new CoState(Account, space.current?.creatorId));
  let adminGroup = $derived(new CoState(Group, space.current?.adminGroupId));

  let channel = $derived(
    new CoState(Channel, page.params.channel, {
      resolve: {
        mainThread: true,
        subThreads: true,
        pages: true,
      },
    }),
  );

  let thread = $derived(new CoState(Thread, page.params.thread));

  let timeline = $derived.by(() => {
    const currentTimeline =
      thread.current?.timeline ?? channel.current?.mainThread?.timeline;

    return Object.values(currentTimeline?.perAccount ?? {})
      .map((accountFeed) => new Array(...accountFeed.all))
      .flat()
      .sort((a, b) => a.madeAt.getTime() - b.madeAt.getTime())
      .map((a) => a.value);
  });

  let threadId = $derived(
    thread.current?.id ?? channel.current?.mainThread?.id,
  );

  const readonly = $derived(thread.current?.name === "@links");

  let tab = $state<"chat" | "board">("chat");

  const me = new AccountCoState(RoomyAccount, {
    resolve: {
      profile: {
        joinedSpaces: true,
      },
    },
  });

  function setLastRead() {
    if (!me?.current?.root) return;

    if (!me?.current?.root?.lastRead) {
      me.current.root.lastRead = LastReadList.create({});
    }

    if (page.params.channel) {
      me.current.root.lastRead[page.params.channel] = new Date();
    }

    if (page.params.thread) {
      me.current.root.lastRead[page.params.thread] = new Date();
    }
  }

  // Initialize tab based on hash if present
  // TODO: move this functionality to somewhere else
  // (not hash based, so we can actually move backwards with browser back button)
  // function updateTabFromHash() {
  //   const hash = window.location.hash.replace("#", "");
  //   if (hash === "chat" || hash === "board") {
  //     tab = hash as "chat" | "board";
  //   }
  // }

  // $effect(() => {
  //   updateTabFromHash();
  // });

  // // Update the hash when tab changes
  // $effect(() => {
  //   if (tab) {
  //     window.location.hash = tab;
  //   }
  // });

  let messageInput: string = $state("");

  // thread maker
  let threadTitleInput = $state("");

  let filesInMessage: File[] = $state([]);

  async function addThread(e: SubmitEvent) {
    e.preventDefault();
    const messageIds = <string[]>[];

    const sortedMessages = threading.selectedMessages
      .map((messageId) => {
        const messageIndex = timeline.findIndex(
          (message) => message === messageId,
        );
        return [messageId, messageIndex] as [string, number];
      })
      .sort((a, b) => a[1] - b[1]);

    let firstMessage: co.loaded<typeof Message> | undefined = undefined;

    for (const [messageId, _] of sortedMessages) {
      messageIds.push(messageId);

      const message = await Message.load(messageId, {
        resolve: {
          hiddenIn: true,
        },
      });
      if (!message) {
        console.error("Message not found when creating thread", messageId);
        continue;
      }
      // hide all messages except the first message in original thread
      if (firstMessage) {
        if (threadId) message.hiddenIn.push(threadId);
      } else {
        firstMessage = message;
      }
    }

    const channelId = channel.current?.id ?? thread.current?.channelId ?? "";

    let newThread = createThread(messageIds, channelId, threadTitleInput);

    if (firstMessage) {
      firstMessage.threadId = newThread.id;
    }

    space.current?.threads?.push(newThread);

    channel.current?.subThreads.push(newThread);
    threading.active = false;
    threading.selectedMessages = [];
    toast.success("Thread created", { position: "bottom-end" });
  }

  let isSendingMessage = $state(false);

  const notifications = $derived(
    me.current?.profile?.roomyInbox?.filter(
      (x) =>
        x &&
        (x.channelId === channel.current?.id ||
          x.threadId === thread.current?.id) &&
        !x.read,
    ),
  );

  $effect(() => {
    if (notifications && notifications.length > 0) {
      // remove those from the inbox
      for (
        let i = (me.current?.profile?.roomyInbox?.length ?? 0) - 1;
        i >= 0;
        i--
      ) {
        const item = me.current?.profile?.roomyInbox?.[i];
        if (
          item &&
          (item.channelId === channel.current?.id ||
            item.threadId === thread.current?.id) &&
          !item.read
        ) {
          item.read = true;
        }
      }
    }
  });

  async function sendMessage() {
    if (!user.agent || !space.current) return;

    isSendingMessage = true;

    let filesUrls: ImageUrlEmbedCreate[] = [];
    // upload files
    for (const file of filesInMessage) {
      const uploadedFile = await user.uploadBlob(file);

      filesUrls.push({
        type: "imageUrl",
        data: {
          url: uploadedFile.url,
        },
      });
    }

    const message = createMessage(
      messageInput,
      undefined,
      adminGroup.current || undefined,
      filesUrls,
    );

    let timeline =
      channel.current?.mainThread.timeline ?? thread.current?.timeline;
    if (timeline) {
      timeline.push(message.id);
    }
    if (replyTo.id) {
      message.replyTo = replyTo.id;
      const replyToMessage = await Message.load(replyTo.id);
      const userId = replyToMessage?._edits?.content?.by?.id;
      if (userId) {
        console.log("adding to inbox", userId, message.id);
        addToInbox(
          userId,
          "reply",
          message.id,
          space.current?.id ?? "",
          channel.current?.id ?? "",
          thread.current?.id ?? "",
        );
      }
    }
    // addMessage(timeline?.id ?? "", message.id, messageInput);
    replyTo.id = "";

    // see if we mentioned anyone (all links that start with /user/)
    const allLinks = extractLinks(messageInput);
    for (const link of allLinks) {
      if (link.startsWith("/user/")) {
        const userId = link.split("/")[2];
        console.log("mentioned user", userId);
        if (!userId) continue;

        addToInbox(
          userId,
          "mention",
          message.id,
          space.current?.id ?? "",
          channel.current?.id ?? "",
          thread.current?.id ?? "",
        );
      }
    }

    if (links?.timeline) {
      for (const link of allLinks) {
        if (!link.startsWith("http")) continue;

        const message = createMessage(
          `<a href="${link}">${link}</a>`,
          undefined,
          adminGroup.current || undefined,
        );
        links.timeline.push(message.id);
      }
    }

    messageInput = "";
    for (let i = filesInMessage.length - 1; i >= 0; i--) {
      removeImageFile(i);
    }
    isSendingMessage = false;
  }

  afterNavigate(() => {
    count = timeline.length ?? 0;
  });

  // svelte-ignore state_referenced_locally
  let count = $state(timeline.length ?? 0);

  $effect(() => {
    let newCount = timeline?.length ?? 0;
    if (count < newCount) {
      count = newCount;
      setLastRead();
    }
  });

  const pages = $derived(
    channel.current?.pages?.filter((page) => page && !page.softDeleted) || [],
  );

  const channelThreads = $derived(
    channel.current?.subThreads?.filter(
      (thread) => thread && !thread.softDeleted,
    ) || [],
  );

  function joinSpace() {
    if (!space.current || !me.current) return;

    // add to my list of joined spaces
    me.current?.profile?.joinedSpaces?.push(space.current);

    // add to space.current.members
    space.current?.members?.push(me.current);
  }

  let previewImages: string[] = $state([]);

  function processImageFile(file: File) {
    filesInMessage.push(file);
    previewImages.push(URL.createObjectURL(file));
  }

  function removeImageFile(index: number) {
    let previewImage = previewImages[index];
    filesInMessage = filesInMessage.filter((_, i) => i !== index);
    previewImages = previewImages.filter((_, i) => i !== index);

    if (previewImage) {
      URL.revokeObjectURL(previewImage);
    }
  }

  let bannedHandles = $derived(new Set(space.current?.bans ?? []));

  let users = $derived(
    space.current?.members
      ?.map((member) => ({
        value: member?.id ?? "",
        label: member?.profile?.name ?? "",
      }))
      .filter((user) => user.value && user.label) || [],
  );
  let channels = $derived(
    space.current?.channels
      ?.map((channel) => ({
        value: JSON.stringify({
          id: channel?.id ?? "",
          space: space.current?.id ?? "",
          type: "channel",
        }),
        label: channel?.name ?? "",
      }))
      .filter((channel) => channel.value && channel.label) || [],
  );
  let threads = $derived(
    space.current?.threads
      ?.map((thread) => ({
        value: JSON.stringify({
          id: thread?.id ?? "",
          space: space.current?.id ?? "",
          type: "thread",
        }),
        label: thread?.name ?? "",
      }))
      .filter((thread) => thread.value && thread.label) || [],
  );
  let context = $derived([...channels, ...threads]);

  let hasJoinedSpace = $derived(
    me.current?.profile?.joinedSpaces?.some(
      (joinedSpace) => joinedSpace?.id === space.current?.id,
    ),
  );

  let isBanned = $derived(
    bannedHandles.has(me.current?.profile?.blueskyHandle ?? ""),
  );

  let showSearch = $state(false);
</script>

<!-- hack to get the admin to load ^^ it has to be used somewhere in this file -->
{#if creator.current}
  <div class="absolute top-0 left-0"></div>
{/if}

<header class="dz-navbar">
  <div class="dz-navbar-start flex gap-4">
    {#if channel.current}
      <ToggleNavigation />

      <h4
        class="sm:line-clamp-1 sm:overflow-hidden sm:text-ellipsis text-base-content text-lg font-bold"
        title={"Channel"}
      >
        <span class="flex gap-2 items-center">
          <Icon icon={"basil:comment-solid"} />
          {channel.current.name}
        </span>
      </h4>
    {/if}
  </div>

  {#if channel.current}
    <Tabs.Root
      bind:value={tab}
      class="w-full inline-flex items-center justify-end sm:justify-center"
    >
      <Tabs.List class="dz-tabs dz-tabs-box">
        <Tabs.Trigger value="board" class="dz-tab flex gap-2">
          <Icon
            icon="tabler:clipboard-text{tab === 'board' ? '-filled' : ''}"
            class="text-2xl"
          />
          <p class="hidden sm:block">Board</p>
        </Tabs.Trigger>
        <Tabs.Trigger value="chat" class="dz-tab flex gap-2">
          <Icon
            icon="tabler:message{tab === 'chat' ? '-filled' : ''}"
            class="text-2xl"
          />
          <p class="hidden sm:block">Chat</p>
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
  {/if}

  <div class="hidden sm:flex dz-navbar-end items-center gap-2">
    {#if tab === "chat"}
      <button
        class="btn btn-ghost btn-sm btn-circle"
        onclick={() => (showSearch = !showSearch)}
        title="Toggle search"
      >
        <Icon icon="tabler:search" class="text-base-content" />
      </button>
    {/if}
    <TimelineToolbar createThread={addThread} bind:threadTitleInput />
  </div>
</header>
<div class="divider my-0"></div>

{#if tab === "board"}
  <BoardList items={pages} title="Pages" route="page">
    {#snippet header()}
      <CreatePageDialog />
    {/snippet}
    No pages for this channel.
  </BoardList>
  <BoardList items={channelThreads} title="Threads" route="thread">
    No threads for this channel.
  </BoardList>
{:else if tab === "chat"}
  {#if space.current}
    <div class="flex flex-col h-[calc(100vh-124px)]">
      {#if showSearch && space.current}
        <SearchBar spaceId={space.current.id} bind:showSearch />
      {/if}
      <div class="flex-grow overflow-auto relative h-full">
        <ChatArea
          space={space.current}
          {timeline}
          isAdmin={isSpaceAdmin(space.current)}
          admin={creator.current}
          {threadId}
          allowedToInteract={hasJoinedSpace && !isBanned}
        />
      </div>

      <div class="shrink-0 pt-1">
        {#if replyTo.id}
          <div
            class="flex justify-between bg-secondary text-secondary-content rounded-t-lg px-4 py-2"
          >
            <div class="flex items-center gap-1 overflow-hidden text-xs w-full">
              <span class="shrink-0">Replying to</span>
              <MessageRepliedTo messageId={replyTo.id} />
            </div>
            <Button.Root
              type="button"
              onclick={() => (replyTo.id = "")}
              class="dz-btn dz-btn-circle dz-btn-ghost flex-shrink-0"
            >
              <Icon icon="zondicons:close-solid" />
            </Button.Root>
          </div>
        {/if}
        <div class="">
          {#if user.session}
            {#if hasJoinedSpace}
              {#if readonly}
                <div class="flex items-center grow flex-col">
                  <Button.Root disabled class="w-full dz-btn"
                    >Automated Thread</Button.Root
                  >
                </div>
              {:else if !isBanned}
                <div
                  class="dz-prose prose-a:text-primary prose-a:underline relative isolate"
                >
                  {#if previewImages.length > 0}
                    <div class="flex gap-2 my-2 overflow-x-auto w-full">
                      {#each previewImages as previewImage, index (previewImage)}
                        <div class="size-24 relative shrink-0">
                          <img
                            src={previewImage}
                            alt="Preview"
                            class="absolute inset-0 w-full h-full object-cover"
                          />

                          <button
                            class="btn btn-ghost btn-sm btn-circle absolute p-0.5 top-1 right-1 bg-base-100 rounded-full"
                            onclick={() => removeImageFile(index)}
                          >
                            <Icon icon="tabler:x" class="size-4" />
                          </button>
                        </div>
                      {/each}
                    </div>
                  {/if}

                  <div class="flex gap-1 w-full">
                    <UploadFileButton {processImageFile} />

                    {#key users.length + context.length}
                      <ChatInput
                        bind:content={messageInput}
                        {users}
                        {context}
                        onEnter={sendMessage}
                        {processImageFile}
                      />
                    {/key}
                  </div>
                  <FullscreenImageDropper {processImageFile} />

                  {#if isSendingMessage}
                    <div
                      class="absolute inset-0 flex items-center text-primary justify-center z-20 bg-base-100/80"
                    >
                      <div class="text-xl font-bold flex items-center gap-4">
                        Sending message...
                        <span class="dz-loading dz-loading-spinner mx-auto w-8"
                        ></span>
                      </div>
                    </div>
                  {/if}
                </div>
              {:else}
                <div class="flex items-center grow flex-col">
                  <Button.Root disabled class="w-full dz-btn"
                    >You are banned from this space</Button.Root
                  >
                </div>
              {/if}
            {:else}
              <div class="flex items-center grow flex-col">
                <Button.Root onclick={joinSpace} class="w-full dz-btn"
                  >Join this space to chat</Button.Root
                >
              </div>
            {/if}
          {:else}
            <Button.Root
              class="w-full dz-btn"
              onclick={() => {
                user.isLoginDialogOpen = true;
              }}>Login to Chat</Button.Root
            >
          {/if}
        </div>

        <!-- {#if isMobile}
          <TimelineToolbar {createThread} bind:threadTitleInput />
        {/if} -->
      </div>
    </div>
  {/if}
{/if}
