"use client";
import { useState, useEffect } from "react";

interface BlockGuardProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function BlockGuard({ permission, children, fallback = null }: BlockGuardProps) {
  const [user, setUser] = useState<any>(null);
  const [isMounted, setIsMounted] = useState(false);
  

  useEffect(() => {
    setIsMounted(true);
    const data = localStorage.getItem("oms_user");
    if (data) {
      const parsedUser = JSON.parse(data);
      setUser(parsedUser);

      // Fetch latest permissions dynamically from server to update session
      fetch(`/api/users?username=${encodeURIComponent(parsedUser.username)}`)
        .then(res => res.json())
        .then(updated => {
          if (updated && updated.permissions) {
            const freshSession = { ...parsedUser, permissions: updated.permissions };
            localStorage.setItem("oms_user", JSON.stringify(freshSession));
            setUser(freshSession);
          }
        })
        .catch(() => {});
    }
  }, []);

  if (!isMounted) return null;

  const usernameLower = user?.username?.trim().toLowerCase();
  const isSuperAdmin = ["chintan", "hitesh"].includes(usernameLower) || user?.permissions?.boss === true;

  // WHITELIST LOGIC: If the permission is 'true', or if the user is a super admin, they have access.
  const hasAccess = isSuperAdmin || (
    Array.isArray(permission)
      ? permission.some(p => user?.permissions?.[p] === true)
      : user?.permissions?.[permission] === true
  );

  if (!hasAccess) {
    return <>{fallback}</>; // Shows nothing or custom fallback
  }

  return <>{children}</>; // Shows the actual content
}