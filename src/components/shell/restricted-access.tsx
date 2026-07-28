interface RestrictedAccessProps {
  message: string;
}

export function RestrictedAccess({ message }: RestrictedAccessProps) {
  return (
    <div className="mt-12 text-center">
      <div className="mb-2 text-2xl font-extrabold text-at-navy">Restricted Access</div>
      <div className="mx-auto max-w-[420px] text-base leading-relaxed text-at-slate">
        {message}
      </div>
    </div>
  );
}
