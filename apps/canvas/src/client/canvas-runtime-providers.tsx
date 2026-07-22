"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";
import { useState } from "react";

export function CanvasRuntimeProviders({ children }: { children: ReactNode }) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						gcTime: 15 * 60_000,
						refetchOnWindowFocus: false,
						retry: false,
						staleTime: 5 * 60_000,
					},
				},
			}),
	);

	return (
		<ConfigProvider locale={zhCN}>
			<App message={{ duration: 2.4, maxCount: 3, top: 84 }}>
				<QueryClientProvider client={queryClient}>
					{children}
				</QueryClientProvider>
			</App>
		</ConfigProvider>
	);
}
