"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import type { UserRestriction } from "@/lib/generated/prisma";
import type { RestrictionContextType } from "@/types/restrictions";
import { isPublicRouteFn } from "@/routes";
import { registerServiceWorker } from "@/lib/register-service-worker";

// Cooldown interval in milliseconds (5 minutes)
const RESTRICTION_CHECK_COOLDOWN = 5 * 60 * 1000;

const RestrictionContext = createContext<RestrictionContextType>({
  isRestricted: false,
  restriction: null,
  restrictions: null,
  checkRestriction: async (forceCheck = false) => false,
  submitAppeal: async () => false,
});

export const useRestriction = () => useContext(RestrictionContext);

export function RestrictionProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = authClient.useSession();
  const [isRestricted, setIsRestricted] = useState(false);
  const [restriction, setRestriction] = useState<UserRestriction | null>(null);
  const [restrictions, setRestrictions] = useState<UserRestriction[] | null>(
    null
  );
  const [lastCheckTime, setLastCheckTime] = useState<number>(0);

  const router = useRouter();
  const pathname = usePathname();

  const checkRestriction = async (forceCheck = false): Promise<boolean> => {
    if (!session?.user?.id) return false;

    try {
      const response = await fetch(`/api/users/restrictions/check`);

      if (!response.ok) {
        return false;
      }

      const data = await response.json();

      // Update last check time
      setLastCheckTime(Date.now());

      if (data.restricted) {
        await authClient.getSession();
        setIsRestricted(true);
        setRestriction(data.restriction);
        setRestrictions(data.restrictions);
        return true;
      } else {
        await authClient.getSession();
        setTimeout(() => {
          setIsRestricted(false);
          setRestriction(null);
          setRestrictions(null);
        }, 1000);
        return false;
      }
    } catch (error) {
      console.error("Error checking restriction status:", error);
      return false;
    }
  };

  const submitAppeal = async (appealText: string): Promise<boolean> => {
    if (!session?.user?.id || !restriction) return false;

    try {
      const response = await fetch(`/api/users/restrictions/appeal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appealText,
          restrictionId: restriction.id,
        }),
      });

      if (!response.ok) {
        toast.error("Failed to submit appeal");
        return false;
      }

      toast.success("Appeal submitted successfully");

      // Update local state
      setRestriction({
        ...restriction,
        appealSubmitted: true,
        appealText,
        appealDate: new Date(),
      });

      setRestrictions(
        (prev) =>
          prev?.map((r) =>
            r.id === restriction.id
              ? {
                  ...r,
                  appealSubmitted: true,
                  appealText,
                  appealDate: new Date(),
                }
              : r
          ) || null
      );

      return true;
    } catch (error) {
      console.error("Error submitting appeal:", error);
      toast.error("Failed to submit appeal");
      return false;
    }
  };

  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      const currentTime = Date.now();
      const timeSinceLastCheck = currentTime - lastCheckTime;

      // Only check if the cooldown period has passed or if it's the first check
      if (
        timeSinceLastCheck >= RESTRICTION_CHECK_COOLDOWN ||
        lastCheckTime === 0
      ) {
        checkRestriction();
      }
    }
  }, [status, session]);

  useEffect(() => {
    // Redirect to restricted page if user is restricted and not on a public path
    if (isRestricted && session?.user && !isPublicRouteFn(pathname)) {
      router.push("/account-restricted");
    }
  }, [isRestricted, pathname, session, router]);

  useEffect(() => {
    registerServiceWorker().then((value) =>
      console.log("Provider Service Worker - instansciated", value?.active)
    );
  }, []);

  return (
    <RestrictionContext.Provider
      value={{
        isRestricted,
        restriction,
        restrictions,
        checkRestriction,
        submitAppeal,
      }}
    >
      {children}
    </RestrictionContext.Provider>
  );
}

