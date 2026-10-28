/**
 * The shared shell of the composer's anchored pickers.
 *
 * The preset, modeling and supervisor menus all hang off a button near the
 * bottom of the window, so they are portaled to `document.body` with fixed
 * coordinates and their own dismiss contract: an outside click or Escape closes
 * them, but the click that opened one must not close it in the same gesture.
 */

import { Card, Typography } from "antd";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const { Text } = Typography;

export interface PickerAnchor {
	left: number;
	/** Distance from the viewport top; set when the menu hangs below its button. */
	top?: number;
	/** Distance from the viewport bottom; set instead of `top` when it opens upward. */
	bottom?: number;
	/** Room left on the chosen side, so a long list scrolls instead of overflowing. */
	maxHeight: number;
}

export function PickerShell({
	anchor,
	title,
	subtitle,
	footer,
	width,
	className,
	onClose,
	children,
}: {
	anchor: PickerAnchor;
	title: ReactNode;
	subtitle?: ReactNode;
	footer?: ReactNode;
	width?: number;
	className?: string;
	onClose: () => void;
	children: ReactNode;
}) {
	// Callers pass an inline arrow, so the listener reads it through a ref instead
	// of re-subscribing on every render.
	const onCloseRef = useRef(onClose);
	useEffect(() => {
		onCloseRef.current = onClose;
	});
	// The click that opened the menu is still bubbling when this mounts — React
	// flushes the update inside the click handler, before the event reaches window
	// — so a plain listener would dismiss the menu in the same gesture and a real
	// click would look like it did nothing. Ignore anything from before this mount.
	const mountedAt = useRef(performance.now());
	useEffect(() => {
		const close = (event: MouseEvent) => {
			if (event.timeStamp <= mountedAt.current) return;
			onCloseRef.current();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCloseRef.current();
		};
		window.addEventListener("click", close);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("click", close);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, []);

	return createPortal(
		<Card
			size="small"
			className={className ? `pickmenu ${className}` : "pickmenu"}
			style={{
				position: "fixed",
				top: anchor.top,
				bottom: anchor.bottom,
				left: anchor.left,
				width,
				maxHeight: anchor.maxHeight,
				zIndex: 1100,
			}}
			onClick={(event) => event.stopPropagation()}
			title={
				<div className="pickmenu__title">
					<Text strong>{title}</Text>
					{subtitle ? <Text type="secondary">{subtitle}</Text> : null}
				</div>
			}
		>
			<div className="pickmenu__body">{children}</div>
			{footer ? <div className="pickmenu__foot">{footer}</div> : null}
		</Card>,
		document.body,
	);
}
