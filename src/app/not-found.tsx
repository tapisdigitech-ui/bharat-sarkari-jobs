import Link from "next/link";
import { SearchBar } from "@/components/layout/SearchBar";

export default function NotFound() {
  return (
    <div className="container-page py-16 text-center">
      <p className="text-sm font-bold text-accent-600">404</p>
      <h1 className="mt-2 text-3xl font-extrabold">We couldn&rsquo;t find that page</h1>
      <p className="mx-auto mt-2 max-w-md text-ink-muted">The job may have been removed, or the link may be wrong. Try searching, or browse the sections below.</p>
      <div className="mx-auto mt-6 max-w-xl"><SearchBar id="nf-search" /></div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link className="btn btn-primary" href="/jobs">Latest jobs</Link>
        <Link className="btn btn-outline" href="/state">Browse by state</Link>
        <Link className="btn btn-outline" href="/">Home</Link>
      </div>
    </div>
  );
}
