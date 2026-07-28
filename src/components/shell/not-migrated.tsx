interface NotMigratedProps {
  moduleName: string;
}

export function NotMigrated({ moduleName }: NotMigratedProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-at-lg border border-at-border bg-at-white p-12 text-center shadow-at-sm">
      <div className="text-[0.7rem] font-bold uppercase tracking-wide text-at-slate">
        Not yet migrated
      </div>
      <p className="mt-2 max-w-md text-sm text-at-slate">
        {moduleName} still lives in the Streamlit app. This page is a
        placeholder so the nav doesn&apos;t drop into a 404 — no
        functionality has been built here yet.
      </p>
    </div>
  );
}
