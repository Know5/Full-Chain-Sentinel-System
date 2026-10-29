/**
 * Shared pieces of the settings pages.
 *
 * Settings used to be a pile of nested `Card`s: the page was a white sheet, every
 * block was another white sheet, and every table sat inside a third one. The
 * workbench pages do not do that — they put a table straight on the page and
 * separate blocks with type and spacing — so a settings page and a workbench
 * page never looked like the same product.
 *
 * These primitives are the settings half of that language: one compact action
 * row, one flat section with a heading, and the muted footnote/empty-state
 * styles the tables already use elsewhere. Small framed tiles stay for things
 * that are genuinely a set of choices (a robot channel, a role card), matching
 * the summary tiles on the project page.
 */

import { Typography } from "antd";
import type { ReactNode } from "react";

const { Text } = Typography;

/**
 * The action row at the top of a settings panel.
 *
 * It carries the block's name, a count or state, and the actions that apply to
 * the whole panel. Kept at body level rather than the page header because the
 * panel owns the state behind those actions; the row is deliberately the same
 * height and rhythm as the table toolbars it sits above.
 */
export function SettingsBar({
	title,
	meta,
	extra,
}: {
	title?: ReactNode;
	/** Counts, dirty state, or a one-line explanation; rendered next to the title. */
	meta?: ReactNode;
	extra?: ReactNode;
}) {
	return (
		<div className="settings-bar">
			<div className="settings-bar__main">
				{title ? <span className="settings-bar__title">{title}</span> : null}
				{meta ? <span className="settings-bar__meta">{meta}</span> : null}
			</div>
			{extra ? <div className="settings-bar__extra">{extra}</div> : null}
		</div>
	);
}

/**
 * A flat block inside a settings page.
 *
 * No border and no background: the page sheet is already the frame. The heading
 * carries a hairline so a page with several blocks reads as sections instead of
 * one long form, without the double frame a `Card` introduced.
 */
export function SettingsSection({
	title,
	description,
	extra,
	children,
	className,
}: {
	title?: ReactNode;
	description?: ReactNode;
	extra?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={className ? `settings-section ${className}` : "settings-section"}>
			{title || description || extra ? (
				<div className="settings-section__head">
					<div className="settings-section__heading">
						{title ? <span className="settings-section__title">{title}</span> : null}
						{description ? <span className="settings-section__desc">{description}</span> : null}
					</div>
					{extra ? <div className="settings-section__extra">{extra}</div> : null}
				</div>
			) : null}
			<div className="settings-section__body">{children}</div>
		</section>
	);
}

/** Muted explanatory text under a block or table. */
export function SettingsNote({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<Text type="secondary" className={className ? `settings-note ${className}` : "settings-note"}>
			{children}
		</Text>
	);
}

/**
 * The centred empty state of a settings table.
 *
 * Two lines — what is missing and what to do — instead of one sentence that
 * reads like a rendering error. Mirrors the project and proxy lists.
 */
export function SettingsEmpty({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
	return (
		<div className="settings-empty">
			<Text strong>{title}</Text>
			{hint ? <Text type="secondary">{hint}</Text> : null}
		</div>
	);
}
