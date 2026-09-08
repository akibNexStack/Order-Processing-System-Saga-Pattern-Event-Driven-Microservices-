import type { IconName } from "@/components/ui/icon";

export const navigation: {
  href: string;
  label: string;
  icon: IconName;
  group: string;
}[] = [
  { href: "/", label: "Overview", icon: "grid", group: "Workspace" },
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
  { href: "/services", label: "Services", icon: "server", group: "Operations" },
];

export function currentNavigation(pathname: string) {
  return (
    navigation.find((item) => item.href === pathname) ??
    (pathname.startsWith("/orders/")
      ? navigation.find((item) => item.href === "/orders")
      : undefined)
  );
}
