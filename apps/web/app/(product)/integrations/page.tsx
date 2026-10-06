import { redirect } from "next/navigation";
export default function LegacyConnectionsPage() {
  redirect("/settings#connections");
}
