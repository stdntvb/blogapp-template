export const environment = {
  production: false,
  // Everything goes through the BFF. `ng serve` proxies /api to the Azure
  // Functions host (see proxy.conf.json), which keeps it same-origin so the
  // session cookie is stored and returned.
  apiUrl: '/api',
  bffUrl: '/api',
  authEnabled: true,
};
