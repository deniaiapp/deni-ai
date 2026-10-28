/** The Deni Run app icon, standing in for the product name in the app's own headers. */
export function AppMark({ className = "size-7" }: { className?: string }) {
  return <img src="/icon.svg" alt="Deni Run" draggable={false} className={`${className} shrink-0 rounded-lg`} />;
}
