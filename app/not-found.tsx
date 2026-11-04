import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[560px] px-4 sm:px-6 py-16 grid gap-4">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Page not found</h1>
      <p className="text-[15px] text-ink2">This alert or page does not exist, or it belongs to a repository you are not watching.</p>
      <div className="flex gap-2"><Link href="/alerts" className="btn">Go to alerts</Link><Link href="/" className="btn-ghost">Home</Link></div>
    </div>
  );
}
