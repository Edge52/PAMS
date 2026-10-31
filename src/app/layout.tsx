import type { Metadata } from "next";
import "./globals.css";
import { SideNav } from "@/components/side-nav";
import { TopBar } from "@/components/shell/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/permissions";

export const metadata: Metadata = {
  title: { default: "Hospital PAMS", template: "%s · Hospital PAMS" },
  description: "Hospital procurement, BOQ and medical asset management",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;600&display=swap"
        />
      </head>
      <body className="min-h-screen">
        {user ? (
          <div className="flex min-h-screen">
            <SideNav perms={permissionsOf(user.role)} />
            <main className="min-w-0 flex-1 px-5 py-3 md:px-8 lg:px-10">
              <TopBar user={user} />
              {children}
            </main>
          </div>
        ) : (
          <main className="px-5 py-6">{children}</main>
        )}
      </body>
    </html>
  );
}
