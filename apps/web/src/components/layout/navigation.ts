import type { IconName } from "@/components/ui/icon";

export const navigation: {
  href: string;
  label: string;
  icon: IconName;
  group: string;
}[] = [
  { href: "/", label: "Overview", icon: "grid", group: "Workspace" },
  { href: "/features", label: "Platform Features", icon: "info", group: "Workspace" },
  {
    href: "/orders/new",
    label: "Create Order",
    icon: "plus",
    group: "Workspace",
  },
  { href: "/orders", label: "Orders", icon: "orders", group: "Workspace" },
  {
    href: "/attention",
    label: "Attention",
    icon: "alert",
    group: "Operations",
  },
  { href: "/admin/payments", label: "Payment approvals", icon: "alert", group: "Operations" },
  { href: "/services", label: "Services", icon: "server", group: "Operations" },
  { href: "/account", label: "Account", icon: "info", group: "Workspace" },
];

export function currentNavigation(pathname: string) {
  if (["/login", "/register", "/account", "/forgot-password", "/reset-password", "/verify-email"].includes(pathname)) return { href: pathname, label: pathname === "/register" ? "Register" : pathname === "/login" ? "Sign in" : pathname === "/account" ? "Account" : pathname === "/forgot-password" ? "Password recovery" : pathname === "/reset-password" ? "Set new password" : "Verify email", icon: "info" as IconName, group: "Workspace" };
  return (
    navigation.find((item) => item.href === pathname) ??
    (pathname.startsWith("/orders/")
      ? navigation.find((item) => item.href === "/orders")
      : undefined)
  );
}
