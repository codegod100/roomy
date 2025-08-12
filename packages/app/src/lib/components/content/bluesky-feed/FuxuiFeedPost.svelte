<script lang="ts">
  import { Post } from '@fuxui/social';
  import Icon from "@iconify/svelte";
  import { getRelativeTime, getBlueskyUrl } from "$lib/utils/atprotoFeeds";
  
  let {
    post,
    showingThread = false,
    onThreadClick,
    onBookmark,
    onHide,
    isBookmarked,
    isHidden,
    getFeedName,
    getFeedUrl
  }: {
    post: any;
    showingThread?: boolean;
    onThreadClick?: (uri: string) => void;
    onBookmark?: (post: any) => void;
    onHide?: (post: any) => void;
    isBookmarked?: (post: any) => boolean;
    isHidden?: (uri: string) => boolean;
    getFeedName?: (source: string) => string;
    getFeedUrl?: (source: string) => string;
  } = $props();

  function handlePostClick() {
    if (!post.isThreadRoot && !post.isReply && !showingThread && onThreadClick) {
      onThreadClick(post.uri);
    }
  }

  function handleBookmarkClick(e: Event) {
    e.stopPropagation();
    if (onBookmark) onBookmark(post);
  }

  function handleHideClick(e: Event) {
    e.stopPropagation();
    if (onHide) onHide(post);
  }

  // Transform our post data to match the @fuxui/social format
  $: postData = {
    author: {
      displayName: post.author.displayName || post.author.handle,
      handle: post.author.handle,
      avatar: post.author.avatar,
      href: `https://bsky.app/profile/${post.author.handle}`
    },
    createdAt: post.record.createdAt,
    replyCount: post.replyCount,
    repostCount: post.repostCount,
    likeCount: post.likeCount
  };
</script>

<div
  class="transition-all
    {post.isThreadRoot
      ? 'border-l-4 border-l-blue-500 bg-blue-50/50 dark:bg-blue-900/20'
      : post.isReply
        ? 'border-l-2 border-l-base-300 bg-base-50/50 dark:bg-base-700/50'
        : !showingThread
          ? 'cursor-pointer hover:shadow-md hover:bg-base-50 dark:hover:bg-base-750'
          : ''}"
  style={post.isReply
    ? `margin-left: ${post.replyDepth * 20}px;`
    : ""}
  onclick={handlePostClick}
>
  <Post data={postData}>
    <!-- Custom header additions -->
    {#if getFeedName && getFeedUrl}
      <div class="flex justify-end mb-2">
        <a
          href={getFeedUrl(post.feedSource)}
          target="_blank"
          rel="noopener"
          class="inline-flex items-center px-2 py-1 text-xs bg-accent-100 dark:bg-accent-900/30 text-accent-800 dark:text-accent-200 rounded-md hover:bg-accent-200 dark:hover:bg-accent-900/50 transition-colors"
          onclick={(e) => e.stopPropagation()}
        >
          {getFeedName(post.feedSource)}
        </a>
      </div>
    {/if}

    <!-- Post badges -->
    <div class="flex items-center gap-2 mb-3">
      {#if post.record.reply}
        <span
          class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded-full"
        >
          <Icon icon="mdi:reply" class="size-3" />
          Reply
        </span>
      {/if}
      {#if post.isThreadRoot}
        <span
          class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded-full"
        >
          <Icon icon="mdi:message-text" class="size-3" />
          Original Post
        </span>
      {:else if post.isReply}
        <span
          class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded-full"
        >
          <Icon icon="mdi:reply" class="size-3" />
          Reply
        </span>
      {:else if post.replyCount && post.replyCount > 0}
        <span
          class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded-full"
        >
          <Icon icon="mdi:comment-multiple" class="size-3" />
          Thread
        </span>
      {/if}
    </div>

    <!-- Post Content -->
    <div class="mb-4">
      <p class="whitespace-pre-wrap">{post.record.text}</p>
    </div>

    <!-- Post Images -->
    {#if post.images && post.images.length > 0}
      <div class="mb-4">
        {#if post.images.length === 1}
          <img
            src={post.images[0]}
            alt="Post image"
            class="w-full max-w-md rounded-lg object-cover max-h-80"
            loading="lazy"
          />
        {:else}
          <div
            class="grid gap-2 {post.images.length === 2
              ? 'grid-cols-2'
              : post.images.length === 3
                ? 'grid-cols-3'
                : 'grid-cols-2'}"
          >
            {#each post.images as image, i}
              <img
                src={image}
                alt="Post image {i + 1}"
                class="w-full rounded-lg object-cover aspect-square {post
                  .images.length > 4 && i >= 4
                  ? 'hidden'
                  : ''}"
                loading="lazy"
              />
            {/each}
            {#if post.images.length > 4}
              <div
                class="flex items-center justify-center bg-base-300 rounded-lg aspect-square text-sm font-medium"
              >
                +{post.images.length - 4} more
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Custom Actions -->
    <div class="flex items-center justify-end gap-3 pt-2 border-t border-base-200 dark:border-base-700">
      {#if onBookmark && isBookmarked}
        <button
          onclick={handleBookmarkClick}
          class="text-yellow-600 dark:text-yellow-400 hover:text-yellow-700 dark:hover:text-yellow-300 flex items-center gap-1 transition-colors"
          title={isBookmarked(post) ? "Remove bookmark" : "Bookmark thread"}
        >
          <Icon 
            icon={isBookmarked(post) ? "mdi:bookmark" : "mdi:bookmark-outline"} 
            class="size-4" 
          />
          {isBookmarked(post) ? "Bookmarked" : "Bookmark"}
        </button>
      {/if}
      
      {#if onHide && isHidden}
        <button
          onclick={handleHideClick}
          class="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 flex items-center gap-1 transition-colors"
          title={isHidden(post.uri) ? "Unhide thread" : "Hide thread"}
        >
          <Icon 
            icon={isHidden(post.uri) ? "mdi:eye-off" : "mdi:eye-off-outline"} 
            class="size-4" 
          />
          {isHidden(post.uri) ? "Unhide" : "Hide"}
        </button>
      {/if}
      
      <a
        href={getBlueskyUrl(post)}
        target="_blank"
        rel="noopener"
        class="text-accent-600 dark:text-accent-400 hover:text-accent-700 dark:hover:text-accent-300 flex items-center gap-1 hover:underline transition-colors"
        onclick={(e) => e.stopPropagation()}
      >
        <Icon icon="mdi:open-in-new" class="size-4" />
        View on Bluesky
      </a>
    </div>
  </Post>
</div>