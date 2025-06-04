import { Message, Channel } from "$lib/schema"
import { page } from "$app/state";


export let ChannelState = $state({channel: new Channel(), messages: [] as Message[]})


export async function loadMessages() {
    const channelId = page.params.channel
    ChannelState.channel = await Channel.load(channelId)
    ChannelState.messages = ChannelState.channel.messages
}
