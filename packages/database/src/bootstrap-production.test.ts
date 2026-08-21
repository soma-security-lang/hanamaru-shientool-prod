import {describe,expect,it} from "vitest";
import {productionBootstrapConfig} from "./bootstrap-production.js";

const validEnv=():NodeJS.ProcessEnv=>({
  NODE_ENV:"production",
  BOOTSTRAP_ORGANIZATION_ID:"11111111-1111-4111-8111-111111111111",
  BOOTSTRAP_BRANCH_ID:"22222222-2222-4222-8222-222222222222",
  BOOTSTRAP_INITIAL_MANAGER_USER_ID:"33333333-3333-4333-8333-333333333333",
  BOOTSTRAP_INITIAL_MANAGER_MEMBERSHIP_ID:"44444444-4444-4444-8444-444444444444",
  BOOTSTRAP_ORGANIZATION_KEY:"hanamaru",
  BOOTSTRAP_ORGANIZATION_NAME:"華まる",
  BOOTSTRAP_BRANCH_KEY:"central",
  BOOTSTRAP_BRANCH_NAME:"中央店",
  BOOTSTRAP_INITIAL_MANAGER_EMAIL:"manager@example.invalid",
  BOOTSTRAP_INITIAL_MANAGER_DISPLAY_NAME:"初期管理者",
  BOOTSTRAP_VERTEX_AI_MODEL:"gemini-2.5-flash",
  PILOT_CONTENT_AI_ENABLED:"false",
  BOOTSTRAP_RETENTION_PDF_DAYS:"180",
  BOOTSTRAP_RETENTION_AUDIO_DAYS:"90",
  BOOTSTRAP_RETENTION_VIDEO_DAYS:"365",
  BOOTSTRAP_RETENTION_TRANSCRIPT_DAYS:"180",
  BOOTSTRAP_RETENTION_REVIEW_DAYS:"180",
  BOOTSTRAP_RETENTION_AUDIT_DAYS:"365",
});

describe("production bootstrap configuration",()=>{
  it("requires every production decision and parses explicit values",()=>{
    expect(productionBootstrapConfig(validEnv())).toMatchObject({ids:{organization:"11111111-1111-4111-8111-111111111111",branch:"22222222-2222-4222-8222-222222222222",managerUser:"33333333-3333-4333-8333-333333333333",managerMembership:"44444444-4444-4444-8444-444444444444"},organizationKey:"hanamaru",branchKey:"central",pilotContentAiEnabled:false,retentionDays:{pdf:180,audio:90,video:365,transcript:180,review:180,audit:365}});
  });
  it("fails closed outside production or when a required decision is absent",()=>{
    expect(()=>productionBootstrapConfig({...validEnv(),NODE_ENV:"test"})).toThrow("NODE_ENV must be production");
    const missing=validEnv();delete missing.BOOTSTRAP_INITIAL_MANAGER_EMAIL;
    expect(()=>productionBootstrapConfig(missing)).toThrow("BOOTSTRAP_INITIAL_MANAGER_EMAIL is required");
  });
  it("requires an explicit pilot flag and bounded retention",()=>{
    expect(()=>productionBootstrapConfig({...validEnv(),PILOT_CONTENT_AI_ENABLED:"yes"})).toThrow("explicitly true or false");
    expect(()=>productionBootstrapConfig({...validEnv(),BOOTSTRAP_RETENTION_AUDIO_DAYS:"0"})).toThrow("between 1 and 3650");
  });
  it("requires approved deterministic identifiers before infrastructure planning",()=>{
    expect(()=>productionBootstrapConfig({...validEnv(),BOOTSTRAP_ORGANIZATION_ID:"not-a-uuid"})).toThrow("BOOTSTRAP_ORGANIZATION_ID must be a UUID");
  });
});
