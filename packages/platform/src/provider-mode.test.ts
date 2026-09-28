import {afterEach,describe,expect,it,vi} from "vitest";
import {createProviders} from "./index.js";

afterEach(()=>vi.unstubAllEnvs());

describe("synthetic review provider boundary",()=>{
  const isolatedUrl="postgresql://hanamaru_api_login:synthetic@localhost/hanamaru_review?host=%2Fcloudsql%2Fmonocle-503402%3Aasia-northeast1%3Asso-review-pg16";
  function configure(){
    vi.stubEnv("NODE_ENV","production");
    vi.stubEnv("K_SERVICE","sso-review-hanamaru-api");
    vi.stubEnv("SYNTHETIC_REVIEW_ONLY","true");
    vi.stubEnv("PROVIDER_MODE","synthetic-review");
    vi.stubEnv("DATABASE_URL",isolatedUrl);
  }
  it("runs local-only providers only on the isolated review service and database",()=>{
    configure();
    expect(createProviders().mode).toBe("local");
    vi.stubEnv("K_SERVICE","hanamaru-pilot-api");
    expect(()=>createProviders()).toThrow(/isolated Cloud Run/);
    vi.stubEnv("K_SERVICE","sso-review-hanamaru-api");
    vi.stubEnv("DATABASE_URL",isolatedUrl.replace("/hanamaru_review?","/hanamaru_prod?"));
    expect(()=>createProviders()).toThrow(/isolated Cloud Run/);
  });
  it("rejects a production database even if its query mentions the review instance",()=>{
    configure();
    vi.stubEnv("DATABASE_URL","postgresql://hanamaru_api_login:synthetic@localhost/hanamaru_prod?application_name=sso-review-pg16");
    expect(()=>createProviders()).toThrow(/isolated Cloud Run/);
  });
});
