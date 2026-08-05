import { ImageResponse } from "next/og";

/**
 * iOS home-screen icon. Apple ignores SVG favicons, so this renders the same
 * mark to a PNG at build time rather than committing a binary that would drift
 * out of step with icon.svg and the Logo component.
 *
 * Satori (what ImageResponse runs on) supports only a subset of SVG, so the mark
 * goes in as a data-URI <img> — the one path that renders arbitrary vector art
 * faithfully. No rounded corners: iOS masks the icon itself, and baking a radius
 * in leaves pale wedges outside the mask.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 18 18">
  <g transform="translate(0 -2)" fill="none">
    <path d="M9 15.5C9 10 12 6.5 16 5.5c0 5.5-3 9-7 10Z" fill="#c2410c"/>
    <path d="M2 16.5C4.5 12 6.5 9.5 9 15.5" stroke="#c2410c" stroke-width="1.4" stroke-linecap="round"/>
  </g>
</svg>`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf7f2",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          width={112}
          height={112}
          src={`data:image/svg+xml;base64,${Buffer.from(MARK).toString("base64")}`}
          alt=""
        />
      </div>
    ),
    size,
  );
}
