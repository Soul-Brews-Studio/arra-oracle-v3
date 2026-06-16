import { useCallback, useEffect, useState } from 'react';

export const FIRST_RUN_COMPLETE_KEY = 'arra-oracle-setup-complete';

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readFirstRunComplete(): boolean {
  try {
    const value = storage()?.getItem(FIRST_RUN_COMPLETE_KEY);
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

export function useFirstRun() {
  const [setupComplete, setSetupComplete] = useState(readFirstRunComplete);

  useEffect(() => {
    setSetupComplete(readFirstRunComplete());
  }, []);

  const markSetupComplete = useCallback(() => {
    try {
      storage()?.setItem(FIRST_RUN_COMPLETE_KEY, '1');
    } catch {}
    setSetupComplete(true);
  }, []);

  const resetSetup = useCallback(() => {
    try {
      storage()?.removeItem(FIRST_RUN_COMPLETE_KEY);
    } catch {}
    setSetupComplete(false);
  }, []);

  return { setupComplete, shouldShowFirstRun: !setupComplete, markSetupComplete, resetSetup };
}
