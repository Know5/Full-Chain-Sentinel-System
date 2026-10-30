import { afterEach, expect, test, vi } from "vitest";
import { presetMenuPosition } from "./PresetMenu.tsx";

afterEach(() => vi.unstubAllGlobals());

test("a picker above the composer leaves space between the menu and viewport edge", () => {
	vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720 });
	const anchor = presetMenuPosition({ left: 32, top: 620, bottom: 650 } as DOMRect);
	expect(anchor.bottom).toBe(104);
	expect(anchor.maxHeight).toBe(320);
	expect(720 - (anchor.bottom ?? 0) - anchor.maxHeight).toBeGreaterThanOrEqual(8);
});

test("a short viewport does not force a minimum height that clips the final item", () => {
	vi.stubGlobal("window", { innerWidth: 360, innerHeight: 160 });
	const anchor = presetMenuPosition({ left: 20, top: 90, bottom: 120 } as DOMRect);
	expect(anchor.bottom).toBe(74);
	expect(anchor.maxHeight).toBe(78);
	expect(160 - (anchor.bottom ?? 0) - anchor.maxHeight).toBe(8);
});

test("a picker below its trigger stays inside the available height and actual width", () => {
	vi.stubGlobal("window", { innerWidth: 360, innerHeight: 720 });
	const anchor = presetMenuPosition({ left: 300, top: 20, bottom: 50 } as DOMRect);
	expect(anchor.top).toBe(54);
	expect(anchor.left + 260).toBeLessThanOrEqual(352);
	expect((anchor.top ?? 0) + anchor.maxHeight).toBeLessThanOrEqual(712);
});
