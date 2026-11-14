import type { Metadata } from "next";
import "./globals.css";
import { SideNav } from "@/components/side-nav";
import { TopBar } from "@/components/shell/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/permissions";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = {
  title: { default: "Hospital PAMS", template: "%s · Hospital PAMS" },
  description: "Hospital procurement, BOQ and medical asset management",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const assistant = user ? await getSetting("assistantEnabled") : false;
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,500&family=IBM+Plex+Sans+Arabic:wght@400;600&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <a href="#content" className="skip-link">Skip to content</a>
        {user ? (
          <div className="flex min-h-screen">
            <SideNav perms={permissionsOf(user.role)} assistant={assistant} role={user.role} />
            <main id="content" tabIndex={-1} className="min-w-0 flex-1 px-5 py-3 outline-none md:px-8 lg:px-10">
              <TopBar user={user} assistant={assistant} />
              {children}
            </main>
          </div>
        ) : (
          <main id="content" tabIndex={-1} className="px-5 py-6 outline-none">{children}</main>
        )}
      </body>
    </html>
  );
}
