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
    if (data) setUser(JSON.parse(data));
  }, []);

  if (!isMounted) return null;

  // BLACKLIST LOGIC: If the permission is explicitly 'true', the user is BLOCKED.
  const isBlocked = user?.permissions?.[permission] === true;

  if (isBlocked) {
    return <>{fallback}</>; // Shows nothing or a custom message
  }

  return <>{children}</>; // Shows the actual content
}