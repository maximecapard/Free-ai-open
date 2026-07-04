"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { detectDeviceProfile } from "@free-ai-open/device-profiler";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { findModeLabel } from "../../_lib/catalog";
import { recommendPerformanceMode } from "../../_lib/deviceRecommendation";

export default function OnboardingDevicePage() {
  const [profile, setProfile] = useState<DeviceProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    detectDeviceProfile().then((result) => {
      if (!cancelled) setProfile(result);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ opacity: 0.6, fontSize: 14 }}>Step 1 of 3</p>
      <h1 style={{ fontSize: 28, margin: "8px 0 24px" }}>Checking your device</h1>

      {!profile ? (
        <p style={{ opacity: 0.7 }}>Running a quick, local-only check...</p>
      ) : (
        <>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ padding: 16, borderRadius: 12, border: "1px solid #333" }}>
              <strong>WebGPU</strong>
              <p style={{ margin: "6px 0 0", fontSize: 14, opacity: 0.8 }}>
                {profile.webgpuAvailable ? "Available on this browser" : "Not available on this browser"}
              </p>
            </div>
            <div style={{ padding: 16, borderRadius: 12, border: "1px solid #333" }}>
              <strong>Recommended mode</strong>
              <p style={{ margin: "6px 0 0", fontSize: 14, opacity: 0.8 }}>
                {findModeLabel(recommendPerformanceMode(profile.deviceTier))} — you can change this on the next
                step.
              </p>
            </div>
          </div>

          <details style={{ marginTop: 16, fontSize: 13, opacity: 0.75 }}>
            <summary style={{ cursor: "pointer" }}>Advanced technical details</summary>
            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginTop: 12 }}>
              <dt>Device tier</dt>
              <dd>
                {profile.deviceTier} ({profile.deviceTierLabel})
              </dd>
              <dt>WASM available</dt>
              <dd>{profile.wasmAvailable ? "yes" : "no"}</dd>
              <dt>Preferred backend</dt>
              <dd>{profile.preferredBackend}</dd>
              <dt>Estimated memory</dt>
              <dd>{profile.estimatedMemoryGb ? `${profile.estimatedMemoryGb} GB` : "unknown"}</dd>
              <dt>Estimated storage quota</dt>
              <dd>{profile.storageQuotaGb ? `${profile.storageQuotaGb} GB` : "unknown"}</dd>
              <dt>Browser</dt>
              <dd>{profile.browserFamily}</dd>
              <dt>OS</dt>
              <dd>{profile.osFamily}</dd>
            </dl>
          </details>

          <Link
            href="/onboarding/task"
            style={{
              display: "inline-block",
              marginTop: 32,
              padding: "12px 20px",
              borderRadius: 12,
              background: "#f7f7f7",
              color: "#0b0b0f",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Continue
          </Link>
        </>
      )}

      <p style={{ marginTop: 32, fontSize: 13, opacity: 0.6 }}>
        This check runs entirely in your browser. Nothing about your device is sent to a server.
      </p>
    </main>
  );
}
