import { AppShell } from "@/components/layout/app-shell";
import { RequireAuth } from "@/components/providers/auth";

/**
 * Everything under (app) is operational data, so the whole group sits behind
 * the session guard rather than each page checking for itself.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
