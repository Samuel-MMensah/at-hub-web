interface TopBarProps {
  title: string;
  subtitle?: string;
}

export function TopBar({ title, subtitle }: TopBarProps) {
  return (
    <div className="mb-8">
      <h1 className="text-[2rem] font-extrabold tracking-tight text-at-navy">{title}</h1>
      {subtitle && <p className="mt-1 text-[1.05rem] font-medium text-at-slate">{subtitle}</p>}
    </div>
  );
}
