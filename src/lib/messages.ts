import type { Message } from "@roomy-chat/sdk";
import { writable } from "svelte/store";
export const latestMessage = writable<Message | null>(null);
