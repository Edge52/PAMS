import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import "./globals.css";
import { SideNav } from "@/components/side-nav";
import { TopBar } from "@/components/shell/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/permissions";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = {
  title: { default: "Hospital PAMS", template: "%s · Hospital PAMS" },
  description: "Hospital procurement, BOQ and medical asset management",
  appleWebApp: { capable: true, title: "PAMS", statusBarStyle: "black-translucent" },
};

/**
 * Fonts (R4, audit wave 30): next/font downloads them once at build time and serves them from the app, so pages look
 * the same on a hospital network without internet. The build itself needs internet (Docker build, or the launcher's
 * first build); without it the build stops with a font error.
 */
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], axes: ["opsz"], variable: "--font-fraunces", display: "swap" });
const plexArabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "600"], variable: "--font-plex-arabic", display: "swap", preload: false });

/** Phone browser bar in the menu colour (wave 26). */
export const viewport: Viewport = { themeColor: "#0c1f1a", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const assistant = user ? await getSetting("assistantEnabled") : false;
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${plexArabic.variable}`}>
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
