"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import UrgentTaskPopup from "@/components/UrgentTaskPopup";
import { getPageTitle } from "@/lib/pageTitles";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";

  const [isLoading, setIsLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false); // Prevents Hydration Error

  // Root layout is a client component (see hydration-guard comment below),
  // so the Next.js Metadata API (Server Component-only) can't set <title>
  // per route here - set document.title imperatively instead, on every
  // pathname change, so each dashboard section gets its own Chrome tab
  // title instead of every tab reading the same URL-derived text.
  useEffect(() => {
    document.title = getPageTitle(pathname);
  }, [pathname]);

  useEffect(() => {
    setIsMounted(true); // Tell React we are now safely in the browser

    const user = localStorage.getItem("oms_user");

    if (isLoginPage) {
      setIsLoading(false);
      return;
    }

    if (!user) {
      router.push("/login");
    } else {
      setIsLoading(false);
      // Trigger background daily backup on initial site access
      fetch("/api/backup/auto", { method: "POST" }).catch((err) =>
        console.error("Auto backup check failed silently:", err)
      );
      // Trigger yesterday's courier-tracking run on initial site access
      fetch("/api/courier/auto", { method: "POST" }).catch((err) =>
        console.error("Courier auto-run check failed silently:", err)
      );
    }
  }, [isLoginPage, router]);

  // If not mounted, return an empty body to match the server's initial HTML
  if (!isMounted) {
    return (
      <html lang="en">
        <head>
          {/* This layout is a Client Component (see the hydration-guard note
              above document.title), so Next's Metadata API can't supply a
              viewport export here - without this tag, mobile browsers assume
              a ~980px desktop-width canvas and let the whole page pan/zoom
              sideways instead of reflowing to the real screen width. */}
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        </head>
        <body className="bg-[#f3f6f9]" suppressHydrationWarning>
          {/* Empty or a static splash screen to match the server */}
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body className="bg-[#f3f6f9] h-dvh overflow-hidden" suppressHydrationWarning>
        {isLoading && !isLoginPage ? (
          <div className="h-dvh flex items-center justify-center bg-[#f3f6f9]">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-blue-600"></div>
          </div>
        ) : !isLoginPage ? (
          <div className="flex flex-col h-full">
            <Header />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
            <Footer />
            <UrgentTaskPopup />
          </div>
        ) : (
          <main className="h-full">{children}</main>
        )}
      </body>
    </html>
  );
}