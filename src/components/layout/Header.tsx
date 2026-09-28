import Link from "next/link";
import { buildPrimaryNav } from "@/config/nav";
import { getRefSafe } from "@/lib/data/ref";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "./Logo";
import { SearchBar } from "./SearchBar";
import { DesktopNav } from "./DesktopNav";
import { MobileMenu } from "./MobileMenu";

export async function Header() {
  const primaryNav = buildPrimaryNav(await getRefSafe());
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow-pop">Skip to main content</a>
      <div className="container-page relative flex h-16 items-center gap-4">
        <Logo />
        <div className="ml-auto hidden max-w-xl flex-1 lg:block"><SearchBar /></div>
        <div className="hidden items-center gap-1 lg:flex">
          <Link href="/alerts" aria-label="Job alerts" className="grid h-11 w-11 place-items-center rounded-lg text-ink-soft hover:bg-brand-50"><Icon name="bell" size={22} /></Link>
          <Link href="/login" className="btn btn-ghost btn-sm">Login</Link>
          <Link href="/register" className="btn btn-primary btn-sm">Register</Link>
        </div>
        <div className="ml-auto lg:hidden"><MobileMenu items={primaryNav} /></div>
      </div>
      <div className="hidden border-t border-line bg-white lg:block">
        <nav aria-label="Main" className="container-page"><DesktopNav items={primaryNav} /></nav>
      </div>
    </header>
  );
}
