import { useMemo } from "react";
import { encode } from "uqr";

/** A QR code drawn in the browser (no request, no image file); always dark on white so any camera reads it. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const grid = useMemo(
    () => encode(text, { ecc: "M", border: 2 }).data,
    [text],
  );
  const size = grid.length;
  const path = useMemo(() => {
    let d = "";
    for (const [y, row] of grid.entries())
      for (const [x, on] of row.entries()) if (on) d += `M${x} ${y}h1v1h-1z`;
    return d;
  }, [grid]);
  return (
    <svg
      className="two-factor-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
