/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // playwright, better-sqlite3 는 서버 전용 네이티브 모듈이라 번들링에서 제외한다.
  serverExternalPackages: ["better-sqlite3", "playwright"],
};

export default nextConfig;
