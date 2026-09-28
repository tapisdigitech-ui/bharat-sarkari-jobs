export function JobSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="card scroll-mt-40 p-4 md:p-6">
      <h2 id={`${id}-h`} className="mb-3 text-lg font-bold text-brand-900 md:text-xl">{title}</h2>
      {children}
    </section>
  );
}
