# Roomy Architecture Documentation

## Overview

Roomy is a "gardenable group chat" platform that enables fluid content transitions from chat messages to wiki-style pages. Built with modern web technologies, it combines AT Protocol (Bluesky), Jazz CRDT (Conflict-free Replicated Data Types), and Svelte 5 to create a local-first, peer-to-peer communication platform.

## Core Philosophy

- **Local-First**: All data is stored locally first, then synchronized peer-to-peer
- **Content Fluidity**: Messages can grow into threads, pages, and wiki content
- **User Agency**: Users own their data and can migrate between instances
- **Gardenable**: Content evolves from ephemeral chat to permanent knowledge

## Technology Stack

### Frontend Framework
- **Svelte 5** with SvelteKit for reactive UI and routing
- **Vite** as build tool with WASM, top-level await, and arraybuffer support
- **Static Site Generation** using `@sveltejs/adapter-static`

### Styling & UI
- **Tailwind CSS v4** for utility-first styling
- **DaisyUI** for component styling themes
- **FuxUI Base** modern component library
- **Bits UI** for accessible components
- **Vaul Svelte** for drawer/modal components

### Data Layer
- **Jazz Tools** - Primary CRDT framework for real-time collaboration
- **AT Protocol** - Integration with Bluesky/ATProto ecosystem
- **IndexedDB** for local storage
- **FlexSearch** for content indexing

### Cross-Platform
- **Tauri** for desktop applications (Windows, macOS, Linux)
- **Web** deployment via Netlify
- **Android** support through Tauri generation

## Project Structure

```
roomy/
├── packages/
│   ├── app/                    # Main SvelteKit application
│   │   ├── src/
│   │   │   ├── routes/         # SvelteKit routing
│   │   │   ├── lib/            # Shared libraries and components
│   │   │   └── app.html        # HTML template
│   │   ├── static/             # Static assets
│   │   ├── src-tauri/          # Tauri desktop app config
│   │   └── package.json
│   ├── sdk/                    # Reusable SDK components
│   ├── sdk-docs/              # API documentation
│   └── tsconfig/              # Shared TypeScript configurations
├── sdk/                       # Root-level SDK
└── scripts/                   # Build and deployment scripts
```

## Application Architecture

### Routing Structure

```
src/routes/
├── (app)/                     # Main application layout
│   ├── +layout.svelte         # Root layout with Jazz/ATProto setup
│   ├── +page.svelte           # Landing page
│   ├── [[spaceIndicator=dash]]/  # Dynamic space routing
│   │   ├── [space=covalue]/   # Space-specific routes
│   │   │   ├── +layout.svelte # Space layout with navigation
│   │   │   ├── +page.svelte   # Space home
│   │   │   ├── [channel]/     # Channel pages
│   │   │   │   └── +page.svelte
│   │   │   ├── thread/[thread]/ # Thread conversations
│   │   │   │   └── +page.svelte
│   │   │   └── page/[page]/   # Wiki-style pages
│   │   │       └── +page.svelte
│   │   ├── [id=domain]/       # Domain-based user routing
│   │   ├── [id=leaf]/         # Leaf protocol routing
│   │   └── messages/          # Direct messages
│   ├── home/                  # User home page
│   ├── user/                  # User profiles
│   ├── admin/                 # Administrative interface
│   └── import-space/          # Space import utility
└── (internal)/                # Internal routes
    └── oauth/                 # OAuth callback handling
```

### Component Hierarchy

```
lib/components/
├── ui/                        # Base UI components
│   ├── Sidebar.svelte         # ServerBar container
│   ├── Navbar.svelte          # Top navigation
│   └── SpaceSidebar.svelte    # Space-specific sidebar
├── Message/                   # Message-related components
│   ├── MessageReactions.svelte
│   ├── MessageRepliedTo.svelte
│   ├── MessageThreadBadge.svelte
│   ├── MessageToolbar.svelte
│   └── embeds/                # Rich embeds
│       └── ImageUrlEmbed.svelte
├── dm/                        # Direct messaging
│   ├── DMContainer.svelte
│   ├── DMList.svelte
│   └── MessageList.svelte
├── helper/                    # Utility components
│   ├── EmojiPicker.svelte
│   ├── FullscreenImageDropper.svelte
│   └── UploadFileButton.svelte
├── search/                    # Search functionality
│   ├── SearchBar.svelte
│   ├── SearchResults.svelte
│   └── search.svelte.ts
├── Core Components            # Main feature components
│   ├── ServerBar.svelte       # Server/space navigation
│   ├── SidebarMain.svelte     # Channel list and navigation
│   ├── SidebarChannelList.svelte
│   ├── SidebarChannelButton.svelte
│   ├── TimelineView.svelte    # Chat and board view
│   ├── ChatArea.svelte        # Message timeline
│   ├── ChatInput.svelte       # Message composition
│   ├── ChatMessage.svelte     # Individual message display
│   ├── BoardList.svelte       # Page/thread lists
│   ├── PageEditor.svelte      # Wiki page editing
│   ├── Login.svelte           # Authentication
│   └── UserProfile.svelte     # User profile display
```

## Data Layer (Jazz CRDT Schema)

### Core Data Structures

```typescript
// Spaces - Top-level containers
export const Space = co.map({
  name: z.string(),
  imageUrl: z.string().optional(),
  description: z.string().optional(),
  channels: co.list(Channel),
  categories: co.list(Category),
  members: co.list(co.account()),
  threads: co.list(Thread),
  pages: co.list(Page),
  creatorId: z.string(),
  adminGroupId: z.string(),
  bans: co.list(z.string()),
  version: z.number().optional()
});

// Channels - Organized conversations
export const Channel = co.map({
  name: z.string(),
  mainThread: Thread,
  subThreads: co.list(Thread),
  pages: z.optional(co.list(Page)),
  softDeleted: z.boolean().optional(),
  // ATProto feed integration
  showAtprotoFeeds: z.boolean().optional(),
  atprotoFeedsConfig: z.optional(z.object({
    feeds: z.array(z.string()),
    threadsOnly: z.boolean(),
  }))
});

// Messages - Core communication unit
export const Message = co.map({
  content: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  author: z.string().optional(),        // ATProto format support
  replyTo: z.string().optional(),
  reactions: ReactionList,
  embeds: z.optional(co.list(Embed)),
  threadId: z.string().optional(),
  hiddenIn: co.list(z.string()),
  softDeleted: z.boolean().optional()
});

// User accounts and profiles
export const RoomyAccount = co.account({
  profile: RoomyProfile,
  root: RoomyRoot
});

export const RoomyProfile = co.profile({
  name: z.string(),
  imageUrl: z.string().optional(),
  blueskyHandle: z.string().optional(),
  joinedSpaces: SpaceList,
  roomyInbox: co.list(InboxItem),
  bannerUrl: z.string().optional(),
  description: z.string().optional(),
  threadSubscriptions: z.optional(co.list(z.string()))
});
```

### Data Flow

1. **User Authentication**: AT Protocol OAuth → Jazz account creation
2. **Space Discovery**: Public spaces list → Join/create spaces
3. **Real-time Sync**: Jazz CRDT → Automatic conflict resolution
4. **Content Creation**: Messages → Threads → Pages (fluid transitions)
5. **Cross-Platform**: Local storage → P2P sync → Multi-device access

## Key Features

### Content Fluidity System
- **Messages**: Basic chat communication
- **Threads**: Grouped message conversations
- **Pages**: Wiki-style editable content
- **Transitions**: Seamless evolution from chat to knowledge base

### AT Protocol Integration
- **OAuth Authentication**: Secure login via Bluesky
- **Profile Synchronization**: Handle, avatar, bio sync
- **Feed Aggregation**: Import external feeds into channels
- **Cross-Platform Identity**: Portable identity across instances

### Real-time Collaboration
- **Jazz CRDT**: Conflict-free real-time editing
- **Offline-First**: Local storage with eventual consistency
- **P2P Sync**: Direct device-to-device synchronization
- **Permission System**: Granular access control

### Direct Messaging
- **ATProto DMs**: Native Bluesky messaging integration
- **Conversation Management**: Thread-based organization
- **Rich Content**: Embeds, reactions, file sharing

## State Management

### Svelte 5 Runes Pattern
```typescript
// Component state
let messageInput = $state("");
let isLoading = $state(false);

// Derived values
let filteredMessages = $derived(
  messages.filter(msg => msg.content.includes(searchTerm))
);

// Side effects
$effect(() => {
  if (user.current) {
    syncUserProfile();
  }
});
```

### Global Stores
```typescript
// Key application stores
user.svelte.ts      // ATProto authentication and profile
atproto.svelte.ts   // OAuth client management
utils.svelte.ts     // Navigation and utility functions
dm.svelte.ts        // Direct messaging client
```

### Context Management
- **Jazz Account Context**: CRDT account and permissions
- **Space Context**: Current space and navigation state
- **Theme Context**: UI theme and preferences

## Security & Privacy

### Data Ownership
- **Local-First Storage**: All data stored locally first
- **User-Controlled Sync**: Users control data sharing
- **Portable Identity**: AT Protocol handles for portability
- **Export Capabilities**: Full data export functionality

### Permission System
- **Jazz Groups**: Fine-grained access control
- **Space Administration**: Creator and admin permissions
- **Content Visibility**: Public/private content controls
- **Moderation Tools**: Ban management and content filtering

## Performance & Scalability

### Optimization Strategies
- **Virtual Scrolling**: Large message lists
- **Lazy Loading**: Component and route code splitting
- **Efficient Updates**: Svelte fine-grained reactivity
- **Local Caching**: IndexedDB for offline access

### CRDT Benefits
- **No Server Dependencies**: P2P architecture
- **Automatic Conflict Resolution**: Jazz handles merge conflicts
- **Offline Resilience**: Local-first guarantees
- **Horizontal Scaling**: No central bottleneck

## Development Workflow

### Local Development
```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Run type checking
pnpm check

# Build for production
pnpm build
```

### Testing Strategy
- **Component Testing**: Vitest with Svelte Testing Library
- **E2E Testing**: Playwright for user flows
- **Type Safety**: TypeScript with strict mode
- **Manual Testing**: Cross-platform compatibility

### Deployment
- **Web**: Netlify static deployment
- **Desktop**: Tauri builds for all platforms
- **Mobile**: Progressive Web App capabilities

## Extension Points

### Plugin Architecture
- **Custom Components**: Drop-in UI components
- **Data Schema Extensions**: Additional Jazz schemas
- **Service Integrations**: External API connections
- **Custom Themes**: Tailwind configuration

### API Integration
- **ATProto Services**: Additional Bluesky features
- **External Feeds**: RSS, ActivityPub, etc.
- **File Storage**: Custom blob storage providers
- **Analytics**: Usage tracking integration

## Future Roadmap

### Technical Improvements
- **Mobile Apps**: Native iOS/Android applications
- **Federation**: Cross-instance communication
- **Enhanced Search**: Full-text indexing improvements
- **Performance**: Bundle size optimization

### Feature Additions
- **Voice/Video**: Real-time communication
- **File Sharing**: Advanced attachment system
- **Integrations**: Third-party service connections
- **AI Features**: Content assistance and moderation

## Contributing

### Architecture Decisions
- **ADRs**: Architectural Decision Records in `/docs`
- **RFC Process**: Major changes require discussion
- **Code Review**: All changes reviewed for architecture impact
- **Documentation**: Architecture docs updated with changes

### Guidelines
- **Component Design**: Reusable, accessible, performant
- **Data Modeling**: Jazz-first, with AT Protocol integration
- **State Management**: Svelte 5 patterns preferred
- **Testing**: Test user flows, not implementation details