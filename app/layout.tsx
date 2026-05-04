"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";
  
  const [isLoading, setIsLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false); // Prevents Hydration Error

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
    }
  }, [isLoginPage, router]);

  // If not mounted, return an empty body to match the server's initial HTML
  if (!isMounted) {
    return (
      <html lang="en">
        <body className="bg-[#f3f6f9]">
          {/* Empty or a static splash screen to match the server */}
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body className="bg-[#f3f6f9] h-screen overflow-hidden" cz-shortcut-listen="true">
        {isLoading && !isLoginPage ? (
          <div className="h-screen flex items-center justify-center bg-[#f3f6f9]">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-blue-600"></div>
          </div>
        ) : !isLoginPage ? (
          <div className="flex flex-col h-full">
            <Header />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
            <Footer />
          </div>
        ) : (
          <main className="h-full">{children}</main>
        )}
      </body>
    </html>
  );
}