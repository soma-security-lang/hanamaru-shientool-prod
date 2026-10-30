export * from "./types.js";
export {normalizeExpenseReceiptReading,validateExpenseReceiptInput,type ExpenseReceiptReading,type ExpenseReceiptReadInput} from "./expense-receipt.js";
export { createSoldgraphProvider, createConfiguredSoldgraphProvider, SoldgraphProviderError, type SoldgraphFailureClass } from "./soldgraph.js";
export { probeAudioSource,probeAudioStream,probeVideoSource,probeVideoStream,type AudioMetadata,type VideoMetadata } from "./media.js";
export { acceptLocalUpload,acceptLocalUploadStream,createLocalProviders } from "./local.js";
export { createSoldgraphFixtureProvider } from "./soldgraph-fixture.js";
export { cloudRunAudience,createGcpProviders,createLocalConnectedProviders,createGcpStorageProvider,createGoogleAiProvider,createGoogleDriveProvider,createYahooMarketPriceSourceProvider } from "./gcp.js";
export { CHIRP3_MODEL,buildChirp3BatchRequest,createGoogleSpeechProvider,parseChirp3BatchResponse } from "./google-speech.js";
import { createGcpProviders,createLocalConnectedProviders } from "./gcp.js";
import { createLocalProviders } from "./local.js";
export { createTokenCipher } from "./cipher.js";
export function createProviders() {
  const mode=process.env.PROVIDER_MODE??"local";
  if(mode==="synthetic-review"){
    const database=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):undefined;
    if(process.env.NODE_ENV!=="production"||
      process.env.K_SERVICE!=="sso-review-hanamaru-api"||
      process.env.SYNTHETIC_REVIEW_ONLY!=="true"||
      database?.username!=="hanamaru_api_login"||
      database.pathname!=="/hanamaru_review"||
      database.searchParams.get("host")!=="/cloudsql/monocle-503402:asia-northeast1:sso-review-pg16")
      throw new Error("Synthetic review providers require the isolated Cloud Run service and database");
    return createLocalProviders();
  }
  if(process.env.NODE_ENV==="production"&&!['gcp','local-connected'].includes(mode))
    throw new Error("PROVIDER_MODE must be gcp or local-connected in production");
  if(mode==="gcp")return createGcpProviders();
  if(mode==="local-connected")return createLocalConnectedProviders();
  if(mode==="local")return createLocalProviders();
  throw new Error(`Unsupported PROVIDER_MODE: ${mode}`);
}
