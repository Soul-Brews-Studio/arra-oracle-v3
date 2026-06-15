import { useEffect, useState } from 'react';
import { parseRouteHash, routeHash, type AppRoute } from './routePaths';

export { parseRouteHash, routeHash, type AppRoute } from './routePaths';

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

export function useHashRoute(): [AppRoute, (route: AppRoute) => void] {
  const [route, setRoute] = useState<AppRoute>(() => parseRouteHash(currentHash()));

  useEffect(() => {
    const onHashChange = () => setRoute(parseRouteHash(currentHash()));
    window.addEventListener('hashchange', onHashChange);
    onHashChange();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function navigate(nextRoute: AppRoute) {
    const nextHash = routeHash(nextRoute);
    if (typeof window === 'undefined') return setRoute(nextRoute);
    if (window.location.hash === nextHash) setRoute(parseRouteHash(nextHash));
    else window.location.hash = nextHash;
  }

  return [route, navigate];
}
