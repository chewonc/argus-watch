// Former "Remediation" page. Starting a run now lives on Threats (/alerts); schedules and history live in
// Settings → Automatic fix runs. Kept as a redirect so existing links and notifications still work.
import { redirect } from "next/navigation";

export default function WindowsPage() {
  redirect("/settings#runs");
}
