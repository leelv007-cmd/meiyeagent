import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: "Pro Studio",
	description: "高阶自由画布工作台",
	robots: { follow: false, index: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN">
			<body>{children}</body>
		</html>
	);
}
