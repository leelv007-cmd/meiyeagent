import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
	poweredByHeader: false,
	reactStrictMode: true,
	serverExternalPackages: ["pg"],
	transpilePackages: ["@meiye/core"],
	async headers() {
		return [
			{
				headers: [
					{
						key: "Content-Security-Policy",
						value: "media-src 'self'",
					},
				],
				source: "/:path*",
			},
		];
	},
	webpack(config) {
		config.resolve.extensionAlias = {
			".js": [".ts", ".tsx", ".js"],
		};
		return config;
	},
};

export default nextConfig;
