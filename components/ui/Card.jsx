import { cn } from '@/lib/helpers/cn'

export function Card({ className, title, children }) {
  return (
    <section
      className={cn(
        'rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg backdrop-blur',
        className
      )}
    >
      {title ? <h2 className="mb-4 text-lg font-semibold text-white">{title}</h2> : null}
      {children}
    </section>
  )
}
