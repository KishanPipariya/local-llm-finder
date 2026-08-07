import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ alignItems: "center", background: "#f0ede5", border: "28px solid #102035", color: "#102035", display: "flex", height: "100%", justifyContent: "center", position: "relative", width: "100%" }}>
      <span style={{ color: "#075cff", fontFamily: "serif", fontSize: 300, fontWeight: 800, letterSpacing: -45, marginLeft: -35 }}>M</span>
      <span style={{ background: "#075cff", bottom: 43, height: 46, position: "absolute", right: 43, width: 46 }} />
    </div>,
    size,
  );
}
