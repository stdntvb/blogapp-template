export const environment = {
  production: true,
  // No BFF is deployed with this template (Azure Storage static website cannot
  // host Azure Functions), so public reads go straight to the backend.
  apiUrl: 'https://d-cap-blog-backend---v2.whitepond-b96fee4b.westeurope.azurecontainerapps.io',
  bffUrl: '/api',
  authEnabled: false,
};
