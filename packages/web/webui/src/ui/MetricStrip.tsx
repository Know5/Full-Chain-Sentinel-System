import type { ReactNode } from "react";
import "./metric-strip.css";

export interface MetricItem {
	label: string;
	value: string | number;
	tone?: "success" | "warning" | "danger";
}

export function MetricStrip({ items, note }: { items: MetricItem[]; note?: ReactNode }) {
	return (
		<div className="metric-strip">
			<dl className="metric-strip__values">
				{items.map((item) => (
					<div className="metric-strip__item" key={item.label}>
						<dt>{item.label}</dt>
						<dd className={item.tone ? `metric-strip__value is-${item.tone}` : "metric-strip__value"}>
							{typeof item.value === "number" ? item.value.toLocaleString() : item.value}
						</dd>
					</div>
				))}
			</dl>
			{note ? <span className="metric-strip__note">{note}</span> : null}
		</div>
	);
}
