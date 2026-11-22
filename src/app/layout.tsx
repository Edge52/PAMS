import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
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
 * Fonts (R4, audit wave 30): the font files are in src/app/fonts (from Fontsource, SIL Open Font License; licences
 * beside them) and served by the app, so neither the pages nor the build need internet.
 */
const inter = localFont({ src: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", variable: "--font-inter", display: "swap" });
const fraunces = localFont({ src: "./fonts/fraunces-latin-full-normal.woff2", weight: "100 900", variable: "--font-fraunces", display: "swap" });
const plexArabic = localFont({
  src: [{ path: "./fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2", weight: "400" }, { path: "./fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2", weight: "600" }],
  variable: "--font-plex-arabic", display: "swap", preload: false,
});

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
