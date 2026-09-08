import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "네이버 블로그 자동 발행",
  description: "관심 키워드로 글감을 찾고, 글을 쓰고, 사진을 구해 네이버 블로그에 발행하는 로컬 조종석",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
