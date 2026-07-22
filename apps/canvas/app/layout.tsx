import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CanvasRuntimeProviders } from "@/src/client/canvas-runtime-providers";
import "antd/dist/reset.css";
import "./globals.css";

export const metadata: Metadata = {
	title: "Pro Studio",
	description: "高阶自由画布工作台",
	robots: { follow: false, index: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN">
			<body>
				<AntdRegistry>
					<CanvasRuntimeProviders>{children}</CanvasRuntimeProviders>
				</AntdRegistry>
			</body>
		</html>
	);
}
