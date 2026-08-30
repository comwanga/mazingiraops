"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { visibleNavigation } from "@/lib/capabilities";
import { AuthUser, fetchMe, logout } from "@/lib/api";

export function DashNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<(AuthUser & { capabilities: string[] }) | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchMe()
      .then((current) => {
        if (active) setUser(current);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  async function onLogout() {
    try {
      await logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  if (!user) return <span className="nav-loading" aria-hidden="true" />;

  const navItems = visibleNavigation(user.capabilities);

  return (
    <div className="dash-navigation">
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-expanded={mobileMenuOpen}
        aria-controls="dash-primary-nav"
        aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
      >
        <span className="hamburger-icon" aria-hidden="true" />
        <span className="toggle-text">{mobileMenuOpen ? "Close" : "Menu"}</span>
      </button>

      <nav
        id="dash-primary-nav"
        className={`dash-nav ${mobileMenuOpen ? "is-open" : ""}`}
        aria-label="Primary"
      >
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
            onClick={() => setMobileMenuOpen(false)}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="account-menu" aria-label="Account controls">
        <Link href="/account/password" title={user.email} className="account-user-link">
          <span className="user-avatar" aria-hidden="true">
            {user.displayName.charAt(0).toUpperCase()}
          </span>
          <span className="user-name">{user.displayName}</span>
        </Link>
        <button
          type="button"
          className="link-btn sign-out-btn"
          onClick={() => void onLogout()}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

