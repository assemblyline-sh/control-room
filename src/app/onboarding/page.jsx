// @ts-check
"use client";

import { useRouter } from "next/navigation";
import AddFlow from "@/components/AddFlow/AddFlow";
import { rememberHost } from "@/state/config-context";
import { SshProvider } from "@/state/ssh-context";

/**
 * First run: no host has a factory yet. Finishing shows the host just added.
 */
export default function OnboardingPage() {
  const router = useRouter();
  return (
    <SshProvider>
      <AddFlow
        start={{ step: "where" }}
        onFinish={(host) => {
          rememberHost(host);
          router.replace("/");
        }}
      />
    </SshProvider>
  );
}
