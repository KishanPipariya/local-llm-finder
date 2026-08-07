import { ImageResponse } from "next/og";

export const alt = "Local / LLM — Find a local model your Apple Silicon Mac can run.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ background: "#f0ede5", color: "#102035", display: "flex", height: "100%", width: "100%", padding: "58px", position: "relative" }}>
      <div style={{ border: "2px solid #102035", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", padding: "38px", width: "100%" }}>
        <div style={{ alignItems: "center", display: "flex", fontSize: 27, fontWeight: 800, letterSpacing: -2 }}><span style={{ background: "#075cff", boxShadow: "7px 7px 0 #102035", height: 18, marginRight: 15, width: 18 }} />LOCAL / LLM</div>
        <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "#075cff", fontSize: 20, fontWeight: 800, letterSpacing: 4 }}>APPLE SILICON MODEL FINDER</span><span style={{ fontFamily: "serif", fontSize: 72, fontWeight: 700, letterSpacing: -4, lineHeight: 1.02 }}>Find a local model<br />your Mac can actually run.</span></div>
        <div style={{ alignItems: "center", display: "flex", fontSize: 22, fontWeight: 700, justifyContent: "space-between" }}><span>Private · Current · Practical</span><span style={{ background: "#075cff", color: "white", fontSize: 76, height: 104, lineHeight: 1, padding: "10px 27px" }}>M</span></div>
      </div>
    </div>,
    size,
  );
}
