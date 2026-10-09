import styles from "./page-skeleton.module.css";

type SkeletonVariant =
  | "dashboard"
  | "history"
  | "repositories"
  | "skills"
  | "usage"
  | "audit"
  | "connections"
  | "instructions"
  | "signin";

export function PageSkeleton({ variant }: { variant: SkeletonVariant }) {
  if (variant === "signin") return <SignInSkeleton />;
  const rows = variant === "skills" ? 3 : variant === "usage" ? 2 : 5;
  return (
    <main className={`page ${styles.page}`} aria-busy="true" aria-label="Loading page">
      <div className={styles.pageHead}>
        <div>
          <span className={styles.eyebrow} />
          <span className={styles.heading} />
          <span className={styles.lede} />
        </div>
        <span className={styles.action} />
      </div>
      {variant === "dashboard" ? <DashboardSkeleton /> : <ContentSkeleton variant={variant} rows={rows} />}
    </main>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <section className={styles.launch}>
        <span className={styles.launchIcon} />
        <div className={styles.launchBody}><span /><span className={styles.short} /></div>
        <div className={styles.launchControls}><span /><span /><span className={styles.button} /></div>
      </section>
      <div className={styles.sectionTitle}><span /><span /></div>
      <section className={styles.table}>{[1, 2, 3, 4].map((row) => <SkeletonRow key={row} />)}</section>
    </>
  );
}

function ContentSkeleton({ variant, rows }: { variant: SkeletonVariant; rows: number }) {
  return <section className={`${styles.table} ${variant === "usage" ? styles.usage : ""}`}>
    <div className={styles.tableHeader}><span /><span /><span /></div>
    {Array.from({ length: rows }, (_, index) => <SkeletonRow key={index} />)}
  </section>;
}

function SkeletonRow() {
  return <div className={styles.row}><span /><span /><span /><span className={styles.tiny} /></div>;
}

function SignInSkeleton() {
  return <main className={styles.signin} aria-busy="true" aria-label="Loading sign-in">
    <section className={styles.signinCard}>
      <span className={styles.brand} /><span className={styles.signinHeading} />
      <span className={styles.signinText} /><span className={`${styles.signinText} ${styles.short}`} />
      <span className={styles.signinButton} />
    </section>
  </main>;
}
