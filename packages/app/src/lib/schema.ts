import { Account, Profile as P, coField, co, z, Group, type Loaded } from "jazz-tools";

export const BasicMeta = co.map({
    name: z.string(),
    slug: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
    createdDate: z.number().optional(),
    updatedDate: z.number().optional(),
});

export const Handles = co.list(z.string());

export const ReplyTo = co.map({
    entity: z.string(),
});

export const ImageUri = co.map({
    uri: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    alt: z.string().optional(),
});

export const Images = co.list(z.string());


export const Collection = co.list(z.string());



export const Threads = co.list(z.string());
export const WikiPages = co.list(z.string());
export const Timeline = co.list(z.string());
export const AuthorUris = co.list(z.string());

export const SpaceSidebarNavigation = co.list(z.string());
export const Admins = co.list(z.string());
// export const Bans = co.map({
//     [id: z.string()]: z.boolean().optional(),
// });
export const Reactions = co.list(z.string());

export type ChannelAnnouncementKind =
    | "messageMoved"
    | "messageDeleted"
    | "threadCreated"
    | string;

export const ChannelAnnouncement = co.map({
    kind: z.string()
});


const ProfileSchema = co.map({
    handle: z.string(),
    avatarUrl: z.string(),
    displayName: z.string()
})
type ProfileSchema = co.loaded<typeof ProfileSchema>


const MessageSchema = co.map({
    softDeleted: z.boolean().optional(),
    body: z.string(),
    profile: ProfileSchema,
    get replyTo(): z.ZodOptional<typeof MessageSchema> {
        return z.optional(MessageSchema)
    }
})
type MessageSchema = co.loaded<typeof MessageSchema>


export class Message{
    internal: MessageSchema | undefined | null
    static async load(id: string){
        const internal = await MessageSchema.load(id)
        const message = new Message()
        message.internal = internal
        return message
    }
    static create({body, profile}: {body: string, profile: ProfileSchema}){
        const p = ProfileSchema.create(profile)
        const internal = MessageSchema.create({body, profile: p})
        const message = new Message()
        message.internal = internal
        return message
    }
}



const PageSchema = co.map({
    name: z.string(),
    softDeleted: z.boolean().optional(),
    body: z.string(),
})
type PageSchema = co.loaded<typeof PageSchema>

export class Page{
    internal: PageSchema | undefined | null
    static async load(id: string){
        const internal = await PageSchema.load(id)
        const page = new Page()
        page.internal = internal
        return page
    }
}

const MessageContainerSchema = co.map({
    name: z.string(),
    type: z.string(),
    softDeleted: z.boolean().optional(),
    messages: z.optional(co.list(MessageSchema)),
    wikipages: z.optional(co.list(PageSchema)),
    channelId: z.optional(z.string()),
})
type MessageContainerSchema = co.loaded<typeof MessageContainerSchema>

export class MessageContainer {
    internal: MessageContainerSchema | undefined | null

    get messages() {
        if(!this.internal?.messages) return []
        return this.internal?.messages?.map(message => {
            const m = new Message()
            m.internal = message
            return m
        })
    }
    addMessage(message: Message){
        if(!this.internal) return
        console.log("messages", this.internal.messages?.toJSON())
        for(const m of this.internal.messages){
            if(m?.id === message.internal?.id){
                return
            }
        }
        const messages = this.internal.messages || []
        messages.push(message.internal)
        this.internal.messages = messages
    }
}
export class Channel extends MessageContainer {
    static async load(id: string) {
        const container = await MessageContainerSchema.load(id, {resolve: {messages: {$each: true}}})
        const channel = new Channel()
        channel.internal = container
        return channel
    }
    static create({ name }: { name: string }) {
        const container = MessageContainerSchema.create({ name, type: "channel" })
        const channel = new Channel()
        channel.internal = container
        return channel
    }
    get pages() {
        if(!this.internal?.wikipages) return []
        return this.internal?.wikipages?.filter(page => {
            return !page?.softDeleted
        }).map(page => {
            const p = new Page()
            p.internal = page
            return p
        })
    }


}
export class Thread extends MessageContainer {
    static async load(id: string) {
        const container = await MessageContainerSchema.load(id, {resolve: {messages: {$each: true}}})
        const thread = new Thread()
        thread.internal = container
        return thread
    }
    static create({ name }: { name: string }) {
        const container = MessageContainerSchema.create({ name, type: "thread" })
        const thread = new Thread()
        thread.internal = container
        return thread
    }
}
// export const Channel = co.map({
//     name: z.string(),
//     softDeleted: z.boolean().optional(),
//     messages: z.optional(co.list(Message)),
//     wikipages: z.optional(co.list(WikiPage)),
// })
// export const Thread = co.map({
//     name: z.string(),
//     softDeleted: z.boolean().optional(),
//     messages: z.optional(co.list(Message)),
//     channel: z.optional(Channel),
// })
export const Image = co.map({
    uri: z.string(),
})

export const Category = co.map({
    name: z.string(),
    channels: z.optional(co.list(MessageContainerSchema)),
    softDeleted: z.boolean().optional(),
})

const SpaceSchema = co.map({
    name: z.string(),
    channels: z.optional(co.list(MessageContainerSchema)),
    threads: z.optional(co.list(MessageContainerSchema)),
    image: z.optional(Image),
    wikipages: z.optional(co.list(PageSchema)),
    links: z.optional(MessageContainerSchema),
    categories: z.optional(co.list(Category))
})
type SpaceSchema = co.loaded<typeof SpaceSchema>

export class Space {
    internal: SpaceSchema | undefined | null
    static async load(id: string) {
        const internal = await SpaceSchema.load(id, {resolve: {channels: {$each: true}}})
        const space = new Space()
        space.internal = internal
        return space
    }
    get channels() {
        if (!this.internal || !this.internal.channels) return []
        const channels = this.internal.channels.filter(channel => {
            return channel?.id && !channel.softDeleted
        })
        return channels.map(c => {
            const channel = new Channel()
            channel.internal = c
            return channel
        })
    }
    static create({name}: {name: string}){
        const internal = SpaceSchema.create({name})
        const space = new Space()
        space.internal = internal
        return space
    }
}
export type Category = Loaded<typeof Category>
export type Image = Loaded<typeof Image>

const CatalogSchema = co.map({ spaces: z.optional(co.list(SpaceSchema)) })
type CatalogSchema = Loaded<typeof CatalogSchema>

export class Catalog {
    internal: CatalogSchema | undefined | null
    static async load(id: string) {
        const internal = await CatalogSchema.load(id, {resolve: {spaces: {$each: true}}})
        const catalog = new Catalog()
        catalog.internal = internal
        return catalog
    }
    get spaces() {
        if (!this.internal?.spaces) return []
        const spaces = this.internal.spaces.filter(space => {
            return space?.id
        })
        return spaces.map(space => {
            const s = new Space()
            s.internal = space
            return s
        })
    }
    static create(){
        const internal = CatalogSchema.create({})
        const catalog = new Catalog()
        catalog.internal = internal
        return catalog
    }
    addSpace(space: Space){
        if(!this.internal.spaces){
            this.internal.spaces = co.list(SpaceSchema).create([])
        }
        this.internal.spaces.push(space.internal)
    }
}

export const RoomyRoot = co.map({
});

const profile = co.map({
    did: z.string(),
    name: z.string(),
    inbox: z.string().optional(),
    inboxInvite: z.string().optional(),
})
export let AccountSchema = co.account({
    root: RoomyRoot,
    profile,

});