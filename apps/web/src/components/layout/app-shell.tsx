"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useUiStore } from "@/components/providers/state-provider";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { currentNavigation, navigation } from "./navigation";

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      className="brand"
      aria-label="Saga overview"
      onClick={onNavigate}
    >
      <span className="brand-mark">
        <Icon name="box" width="24" height="24" />
      </span>
      <span>
        Saga<span className="brand-caption">ORDER WORKSPACE</span>
      </span>
    </Link>
  );
}

function Navigation({
  active,
  onNavigate,
}: {
  active?: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary navigation">
      {["Workspace", "Operations"].map((group) => (
        <div className="nav-group" key={group}>
          <p className="nav-label">{group}</p>
          <ul>
            {navigation
              .filter((item) => item.group === group)
              .map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="nav-link"
                    aria-current={active === item.href ? "page" : undefined}
                    onClick={onNavigate}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                    {active === item.href && (
                      <span className="nav-active-dot" aria-hidden="true" />
                    )}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarNote() {
  return (
    <div className="sidebar-note">
      <Icon name="info" />
      <div>
        <strong>Your order workspace</strong>
        <p>One place for orders, progress, and recovery.</p>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = currentNavigation(pathname);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const menuOpen = useUiStore((state) => state.menuOpen);
  const setMenuOpen = useUiStore((state) => state.setMenuOpen);

  function closeMenu() {
    dialogRef.current?.close();
    setMenuOpen(false);
  }

  useEffect(() => {
    if (menuOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [menuOpen]);

  useEffect(() => {
    dialogRef.current?.close();
    setMenuOpen(false);
  }, [pathname, setMenuOpen]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) {
        dialogRef.current?.close();
        setMenuOpen(false);
      }
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [setMenuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Workspace sidebar">
        <Brand />
        <Navigation active={active?.href} />
        <SidebarNote />
        <p className="sidebar-footer">
          Saga Order System <span>v0.1</span>
        </p>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-location">
            <Button
              ref={menuRef}
              variant="ghost"
              className="menu-toggle"
              aria-label="Open navigation"
              aria-controls="mobile-navigation"
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen(true);
              }}
            >
              <Icon name="menu" />
            </Button>
            <span className="breadcrumb-root">Workspace</span>
            <span className="breadcrumb-separator" aria-hidden="true">
              /
            </span>
            <span className="breadcrumb-current">
              {active?.label ?? "Page not found"}
            </span>
          </div>
          <span className="environment-label">
            <span aria-hidden="true" />
            Local workspace
          </span>
        </header>
        <main id="main-content" tabIndex={-1} className="main-content">
          {children}
        </main>
        <footer className="workspace-footer">
          <span>Saga Order System</span>
          <span>
            {pathname === "/services"
              ? "Live service checks · Read-only"
              : pathname === "/orders/new"
                ? "Demo checkout · Live submission"
                : pathname === "/orders" || pathname.startsWith("/orders/")
                  ? "Order lookup · Read-only snapshots"
                  : "Layout preview · No live data"}
          </span>
        </footer>
      </div>
      <dialog
        ref={dialogRef}
        id="mobile-navigation"
        className="mobile-navigation"
        aria-labelledby="navigation-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'a[href], button:not(:disabled), [tabindex="0"]',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
        onClose={() => {
          setMenuOpen(false);
          if (menuRef.current?.getClientRects().length) menuRef.current.focus();
        }}
      >
        <div className="mobile-navigation-inner">
          <div className="mobile-navigation-heading">
            <h2 id="navigation-title">Navigation</h2>
            <Button
              variant="ghost"
              aria-label="Close navigation"
              onClick={closeMenu}
            >
              <Icon name="close" />
            </Button>
          </div>
          <Brand onNavigate={closeMenu} />
          <Navigation active={active?.href} onNavigate={closeMenu} />
          <SidebarNote />
        </div>
      </dialog>
    </div>
  );
}
