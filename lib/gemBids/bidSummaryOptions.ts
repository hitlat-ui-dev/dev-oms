// Shared between the Bid Summary page (client) and its API route (server) -
// kept out of route.ts itself so importing this list from the client page
// never drags that route's server-only imports (mongodb) into the browser bundle.
export const RESULT_OPTIONS = ["Not Open", "Technical Evaluation", "Financial Evaluation", "RA Running", "Bid Awarded"];
