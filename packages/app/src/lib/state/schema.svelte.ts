import { Catalog, Channel, Space } from "$lib/schema"
import { page } from "$app/state";
import { user } from "$lib/user.svelte";

export let ChannelState = $state({channel: new Channel()})
export async function loadChannel() {
    const channelId = page.params.channel
    ChannelState.channel = await Channel.load(channelId)
}


export let SpaceState = $state({space: new Space()})
export async function loadSpace() {
    const spaceId = page.params.space
    console.log("loading space", spaceId    )
    SpaceState.space = await Space.load(spaceId)
}

export let CatalogState = $state({catalog: new Catalog()})
export async function loadCatalog() {
    console.log(user)
    const catalogId = user.catalogId.value
    console.log(catalogId)
    if (!catalogId) return
    CatalogState.catalog = await Catalog.load(catalogId)
}