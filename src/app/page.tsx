import { redirect } from "next/navigation";

// The deployed app is the self-contained GymLog HTML served at "/" via a
// rewrite in next.config.ts. This page is only a fallback in case the rewrite
// is bypassed (e.g. direct app-router navigation).
export default function Home() {
  redirect("/gymlog-classic.html");
}
