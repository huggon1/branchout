import React from "react";
const paths: Record<string, React.ReactNode> = {
  inbox: <><path d="M4 4h16v16H4z"/><path d="M4 13h5l2 3h2l2-3h5M12 6v6m-3-3 3 3 3-3"/></>,
  tasks: <><path d="M9 5h11M9 12h11M9 19h11M3 5h1M3 12h1M3 19h1"/></>,
  library: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11M12 13h5m-5 3h4"/></>,
  sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z"/></>,
  feed: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 7h6M9 11h6M9 15h3"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></>,
};
export function Icon({ name }: { name: string }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.library}</svg>;
}
