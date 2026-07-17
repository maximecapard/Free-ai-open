import { detectDeviceProfile } from "@free-ai-open/device-profiler";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { setStoredCapabilityProfile } from "./capabilityProfileStore";

export async function detectAndStoreDeviceProfile(): Promise<DeviceProfile> {
  const profile = await detectDeviceProfile();
  if (profile.staticCapabilityProfile) {
    setStoredCapabilityProfile(profile.staticCapabilityProfile);
  }
  return profile;
}
