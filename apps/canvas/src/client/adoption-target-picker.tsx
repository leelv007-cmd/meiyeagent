"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdoptionTarget } from "../kernel-host/adoption-adapter";

export type AdoptionTargetOption = {
	handle: {
		baseVersionId: string;
		expectedRevision: number;
		packageId: string;
	};
	id: string;
	title: string;
};

export type AdoptionTargetPage = {
	items: AdoptionTargetOption[];
	nextCursor: string | null;
};

type AdoptionTargetPickerProps = {
	disabled?: boolean;
	onChange(target: AdoptionTargetOption | null): void;
	onError(error: unknown): void;
	requestPage(input: {
		cursor?: string;
		query?: string;
	}): Promise<AdoptionTargetPage>;
	selectedTarget: AdoptionTargetOption | null;
};

export function adoptionTargetQuery(query: string, cursor?: string) {
	const normalizedQuery = query.trim();
	return {
		...(cursor ? { cursor } : {}),
		...(normalizedQuery ? { query: normalizedQuery } : {}),
	};
}

export function appendAdoptionTargetPage(
	current: AdoptionTargetOption[],
	next: AdoptionTargetOption[],
) {
	const byId = new Map(current.map((target) => [target.id, target]));
	for (const target of next) byId.set(target.id, target);
	return [...byId.values()];
}

/** Only a server-returned handle can build the existing-package target. */
export function existingPackageAdoptionTarget(
	target: AdoptionTargetOption,
): AdoptionTarget {
	return {
		baseVersionId: target.handle.baseVersionId,
		expectedRevision: target.handle.expectedRevision,
		kind: "existing_package",
		packageId: target.handle.packageId,
	};
}

export function AdoptionTargetPicker({
	disabled = false,
	onChange,
	onError,
	requestPage,
	selectedTarget,
}: AdoptionTargetPickerProps) {
	const [query, setQuery] = useState("");
	const [items, setItems] = useState<AdoptionTargetOption[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const loadPage = useCallback(
		async (requestedQuery: string, cursor?: string) => {
			setLoading(true);
			try {
				const page = await requestPage(
					adoptionTargetQuery(requestedQuery, cursor),
				);
				setItems((current) =>
					cursor ? appendAdoptionTargetPage(current, page.items) : page.items,
				);
				setNextCursor(page.nextCursor);
			} catch (error) {
				onError(error);
			} finally {
				setLoading(false);
			}
		},
		[onError, requestPage],
	);

	useEffect(() => {
		void loadPage("");
		// The page is intentionally queried once on mount. Search is explicit so
		// partial merchant input does not issue a request on every keystroke.
	}, [loadPage]);

	return (
		<div className="adoption-target-picker">
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void loadPage(query);
				}}
			>
				<label htmlFor="adoption-target-search">搜索已有成品</label>
				<div className="adoption-target-search">
					<input
						disabled={disabled || loading}
						id="adoption-target-search"
						onChange={(event) => setQuery(event.target.value)}
						placeholder="按名称搜索"
						value={query}
					/>
					<button disabled={disabled || loading} type="submit">
						搜索
					</button>
				</div>
			</form>
			<ul aria-label="已有成品搜索结果" className="adoption-target-options">
				{items.length === 0 && !loading ? (
					<li>没有可写入的已有成品。</li>
				) : null}
				{items.map((target) => (
					<li key={target.id}>
						<button
							aria-pressed={selectedTarget?.id === target.id}
							disabled={disabled || loading}
							onClick={() => onChange(target)}
							type="button"
						>
							{target.title}
						</button>
					</li>
				))}
			</ul>
			{nextCursor ? (
				<button
					disabled={disabled || loading}
					onClick={() => void loadPage(query, nextCursor)}
					type="button"
				>
					{loading ? "正在加载…" : "加载更多"}
				</button>
			) : null}
		</div>
	);
}
