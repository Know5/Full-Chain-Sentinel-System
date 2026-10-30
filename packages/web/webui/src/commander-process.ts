import type { SentinelSubagentEvent } from "./types.ts";

export type CommanderEntry =
	| { kind: "event"; event: SentinelSubagentEvent }
	| { kind: "tool"; start: SentinelSubagentEvent; end?: SentinelSubagentEvent };

/** Pair by call ID, keeping each call at its starting position in the conversation. */
export function commanderEntries(events: SentinelSubagentEvent[]): CommanderEntry[] {
	const ends = new Map<string, SentinelSubagentEvent>();
	const started = new Set<string>();
	for (const event of events) {
		if (event.kind === "tool_end" && event.toolCallId) ends.set(event.toolCallId, event);
		if (event.kind === "tool_start" && event.toolCallId) started.add(event.toolCallId);
	}
	const entries: CommanderEntry[] = [];
	for (const event of events) {
		if (event.kind === "tool_start") {
			entries.push({ kind: "tool", start: event, end: event.toolCallId ? ends.get(event.toolCallId) : undefined });
		} else if (event.kind === "tool_end") {
			// A retained result without its start must still be readable.
			if (!event.toolCallId || !started.has(event.toolCallId)) entries.push({ kind: "tool", start: event, end: event });
		} else if (event.kind !== "turn") {
			entries.push({ kind: "event", event });
		}
	}
	return entries;
}
