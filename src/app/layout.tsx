import type { Metadata } from "next";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "LifeRPG · 모험의 서",
  description: "삶의 흔적이 이어지는 나만의 모험",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const content = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <ClerkProvider>{children}</ClerkProvider>
  ) : (
    children
  );
  return (
    <html lang="ko">
      <body>{content}</body>
    </html>
  );
}
