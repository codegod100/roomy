export let ChatState = $state({timeline: {} as Record<string, any>})

export function addLoaded(timelineId: string, id: string) {
    if(!ChatState.timeline[timelineId]){
        ChatState.timeline[timelineId] = {messages: [], loaded: new Set<string>()}
    }
    if(!ChatState.timeline[timelineId].loaded){
        ChatState.timeline[timelineId].loaded = new Set<string>()
    }
    ChatState.timeline[timelineId].loaded.add(id)
    ChatState.timeline[timelineId] = ChatState.timeline[timelineId]
}

export function setTimeline(timelineId: string, newTimeline: string[]) {
    if(!ChatState.timeline[timelineId].messages){
        ChatState.timeline[timelineId].messages = []
    }
    ChatState.timeline[timelineId].messages = newTimeline
    ChatState.timeline[timelineId] = ChatState.timeline[timelineId]
}

export function clearLoaded(timelineId: string){
    ChatState.timeline[timelineId] = ChatState.timeline[timelineId] || {messages: [], loaded: new Set<string>()}
    ChatState.timeline[timelineId] = ChatState.timeline[timelineId].loaded = new Set<string>()
}
