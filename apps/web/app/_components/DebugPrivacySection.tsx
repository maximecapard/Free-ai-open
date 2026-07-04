import { PrivacyNotice } from "./PrivacyNotice";
import { DebugField, DebugSection } from "./DebugSection";

export function DebugPrivacySection({ contentLogged }: { contentLogged: boolean | null }) {
  return (
    <DebugSection title="Privacy">
      <PrivacyNotice />
      <p style={{ fontSize: 13, opacity: 0.75, margin: "8px 0" }}>
        Nothing on this page — including this diagnostic report — ever includes prompt text, model replies, or document
        content. Only technical fields (timings, device info, error codes) are shown or exported.
      </p>
      <DebugField label="contentLogged" value={contentLogged === null ? "—" : String(contentLogged)} />
    </DebugSection>
  );
}
