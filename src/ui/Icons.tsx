import React from "react";
const paths: Record<string, React.ReactNode> = {
  inbox: (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M4 13h5l2 3h2l2-3h5M12 6v6m-3-3 3 3 3-3" />
    </>
  ),
  repo: (
    <>
      <path d="M5 3h12a2 2 0 0 1 2 2v16H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3" />
      <path d="M4 17h15M8 3v9l3-2 3 2V3" />
    </>
  ),
  explore: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" />
    </>
  ),
  compose: (
    <>
      <path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7" />
      <path d="m15 4 3-3 5 5-3 3-7 7-5 1 1-5 7-7Zm0 0 5 5" />
    </>
  ),
  history: (
    <>
      <path d="M3 11a9 9 0 1 1 2 7M3 5v6h6M12 7v5l3 2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  external: (
    <>
      <path d="M14 3h7v7M21 3l-11 11M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
    </>
  ),
  tasks: (
    <>
      <path d="M9 5h11M9 12h11M9 19h11M3 5h1M3 12h1M3 19h1" />
    </>
  ),
  library: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 9v11M12 13h5m-5 3h4" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z" />
    </>
  ),
  feed: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 7h6M9 11h6M9 15h3" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </>
  ),
};
export function Icon({ name }: { name: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.library}
    </svg>
  );
}

/** A folded leaf: collected knowledge, growing from one shared stem. */
export function BrandMark() {
  return (
    <svg
      width="28"
      height="32"
      viewBox="0 0 28 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 27V16C6 7 12 4 23 5v8c0 9-7 13-17 10M6 23 19 10M11 18h8M15 14V8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
